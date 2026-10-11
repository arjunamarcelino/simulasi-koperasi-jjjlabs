import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  deleteQuizQuestion,
  listQuiz,
  upsertQuizQuestion,
  type QuizQuestion,
  type QuizUpsertInput,
} from "../lib/adminApi";
import { adminAuthStore } from "./adminAuth.store";
import { assertNever } from "../lib/assertNever";

/**
 * Quiz content store (SIM-18). A read machine mirroring leaderboard.store (epoch supersession on
 * the READS, one-shot `bridged` → handleAuthLoss, a StrictMode "loaded once" guard), plus
 * create/edit/delete mutations. Writes REFETCH the list rather than optimistically patch it (the
 * safest choice under compare-and-swap edits + last-write-wins). Race-hardening that MUST hold:
 *
 *   - mutation-in-flight lives INSIDE `ready` (`mutating`), never an orthogonal boolean; `ready`
 *     keeps `rows` visible while `refreshing` so the table never blinks away;
 *   - ONE mutation gate blocks save AND delete while a write (or its trailing refetch) is in flight;
 *   - each mutation snapshots `myEpoch = epoch` (NO ++) and gates its tail on `myEpoch === epoch`,
 *     so a result after dispose()/reset() is dropped (no zombie toast / reopened panel);
 *   - `save` resolves to a boolean so the PANEL (which owns the form draft) clears the form only on
 *     a committed write — a failed save keeps the draft for retry (the Q10/A1 requirement);
 *   - a 503 is ambiguous (may have committed) → refetch, never assume-failed; a 401/403 provably
 *     did not commit (gate precedes the DB fn) → bridge to the auth gate.
 */
export type QuizMutating = { kind: "saving" } | { kind: "deleting"; code: string } | null;

export type QuizUiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; rows: QuizQuestion[]; refreshing: boolean; mutating: QuizMutating }
  | { status: "error" } // retryable (serviceUnavailable)
  | { status: "authLost" }; // passive; gate re-probe drives the transition

export type Toast = { tone: "success" | "error"; text: string };

export type QuizContentStoreState = {
  state: QuizUiState;
  toast: Toast | null;
  /** Fetch the list ONCE (StrictMode-safe). Call from the mount effect. */
  load: () => void;
  /** Manual refetch (the error screen's retry). */
  retry: () => void;
  /** Create (prev_updated_at null) or CAS-edit a question. Resolves true iff committed. */
  save: (input: QuizUpsertInput) => Promise<boolean>;
  /** Delete a question by code. Blocked while any mutation is in flight. */
  remove: (code: string) => void;
  /** Abort reads + reset to idle on unmount. */
  dispose: () => void;
};

let epoch = 0;
let currentAbort: AbortController | null = null; // READS only
let bridged = false; // one-shot auth-loss bridge latch (shared by read + save + delete)
let loadedOnce = false; // StrictMode double-mount guard

function setToast(myEpoch: number, toast: Toast): void {
  if (myEpoch !== epoch) return;
  quizContentStore.setState({ toast });
}

/** Safety net: clear the mutation gate if still set under the same epoch (the normal exit is the
 * trailing refetch, which resets `mutating`). */
function clearMutating(myEpoch: number): void {
  if (myEpoch !== epoch) return;
  const s = quizContentStore.getState().state;
  if (s.status === "ready" && s.mutating !== null) {
    quizContentStore.setState({ state: { ...s, mutating: null } });
  }
}

function reset(): void {
  epoch++;
  currentAbort?.abort();
  currentAbort = null;
  bridged = false;
  loadedOnce = false;
  quizContentStore.setState({ state: { status: "idle" }, toast: null });
}

async function runList(opts: { refreshing: boolean }): Promise<void> {
  const myEpoch = ++epoch;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;

  const cur = quizContentStore.getState().state;
  if (opts.refreshing && cur.status === "ready") {
    quizContentStore.setState({
      state: { status: "ready", rows: cur.rows, refreshing: true, mutating: null },
    });
  } else {
    quizContentStore.setState({ state: { status: "loading" } });
  }

  const outcome = await listQuiz(ac.signal);
  if (myEpoch !== epoch) return; // superseded / reset → drop

  switch (outcome.kind) {
    case "ok":
      bridged = false;
      quizContentStore.setState({
        state: { status: "ready", rows: outcome.data, refreshing: false, mutating: null },
      });
      break;
    case "serviceUnavailable":
      quizContentStore.setState({ state: { status: "error" } });
      break;
    case "unauthenticated":
    case "notAuthorized":
      handleAuthLoss(myEpoch);
      break;
    default:
      assertNever(outcome);
  }
}

async function runSave(input: QuizUpsertInput): Promise<boolean> {
  const s0 = quizContentStore.getState().state;
  if (s0.status !== "ready" || s0.mutating !== null || s0.refreshing) return false;
  const myEpoch = epoch; // snapshot (NOT ++)
  quizContentStore.setState({ state: { ...s0, mutating: { kind: "saving" } } });
  try {
    const outcome = await upsertQuizQuestion(input);
    if (myEpoch !== epoch) return outcome.kind === "ok"; // zombie: dropped, but report commit truth
    switch (outcome.kind) {
      case "ok":
        setToast(myEpoch, { tone: "success", text: `Pertanyaan "${outcome.data.code}" tersimpan.` });
        void runList({ refreshing: true });
        return true;
      case "conflict":
        if (outcome.reason === "stale_write") {
          setToast(myEpoch, { tone: "error", text: "Data berubah di tempat lain — memuat ulang." });
          void runList({ refreshing: true });
        } else {
          setToast(myEpoch, { tone: "error", text: "Kode pertanyaan sudah dipakai." });
        }
        return false;
      case "rejected":
        setToast(myEpoch, { tone: "error", text: "Input ditolak server. Periksa isian." });
        return false;
      case "notFound":
        setToast(myEpoch, { tone: "error", text: "Pertanyaan tidak ditemukan — memuat ulang." });
        void runList({ refreshing: true });
        return false;
      case "serviceUnavailable":
        setToast(myEpoch, { tone: "error", text: "Status tidak pasti — memuat ulang daftar." });
        void runList({ refreshing: true });
        return false;
      case "unauthenticated":
      case "notAuthorized":
        setToast(myEpoch, { tone: "error", text: "Tidak tersimpan — sesi admin berakhir." });
        handleAuthLoss(myEpoch);
        return false;
      default:
        return assertNever(outcome);
    }
  } finally {
    clearMutating(myEpoch);
  }
}

async function runRemove(code: string): Promise<void> {
  const s0 = quizContentStore.getState().state;
  if (s0.status !== "ready" || s0.mutating !== null || s0.refreshing) return;
  const myEpoch = epoch; // snapshot (NOT ++)
  quizContentStore.setState({ state: { ...s0, mutating: { kind: "deleting", code } } });
  try {
    const outcome = await deleteQuizQuestion(code);
    if (myEpoch !== epoch) return; // zombie → drop
    switch (outcome.kind) {
      case "ok":
      case "notFound":
        setToast(myEpoch, { tone: "success", text: `Pertanyaan "${code}" dihapus.` });
        void runList({ refreshing: true });
        break;
      case "blocked":
        setToast(myEpoch, {
          tone: "error",
          text: "Tidak bisa dihapus: sudah pernah dijawab peserta.",
        });
        break;
      case "serviceUnavailable":
        setToast(myEpoch, { tone: "error", text: "Status tidak pasti — memuat ulang daftar." });
        void runList({ refreshing: true });
        break;
      case "unauthenticated":
      case "notAuthorized":
        setToast(myEpoch, { tone: "error", text: "Tidak terhapus — sesi admin berakhir." });
        handleAuthLoss(myEpoch);
        break;
      default:
        assertNever(outcome);
    }
  } finally {
    clearMutating(myEpoch);
  }
}

/** At most ONE gate re-probe per auth-loss (shared latch). A second loss falls to a manual-retry
 * error — same discipline as the other stores. We NEVER write the gate directly. */
function handleAuthLoss(myEpoch: number): void {
  if (bridged) {
    quizContentStore.setState({ state: { status: "error" } });
    return;
  }
  bridged = true;
  quizContentStore.setState({ state: { status: "authLost" } });
  void (async () => {
    await adminAuthStore.getState().retry();
    if (myEpoch !== epoch) return;
    if (adminAuthStore.getState().gate.status === "authorized") {
      quizContentStore.setState({ state: { status: "error" } });
    }
  })();
}

export const quizContentStore = createStore<QuizContentStoreState>()(() => ({
  state: { status: "idle" },
  toast: null,

  load: () => {
    if (loadedOnce) return;
    loadedOnce = true;
    bridged = false;
    void runList({ refreshing: false });
  },

  retry: () => {
    void runList({ refreshing: false });
  },

  save: (input) => runSave(input),

  remove: (code) => {
    void runRemove(code);
  },

  dispose: () => reset(),
}));

/** Test-only reset of module singletons. */
export function __resetQuizContentForTest(): void {
  epoch = 0;
  currentAbort = null;
  bridged = false;
  loadedOnce = false;
  quizContentStore.setState({ state: { status: "idle" }, toast: null });
}

export function useQuizContent<T>(selector: (s: QuizContentStoreState) => T): T {
  return useStore(quizContentStore, selector);
}
