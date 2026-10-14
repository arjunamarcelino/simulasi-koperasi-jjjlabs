import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { listMissions, rotateMissionCode, type MissionRow } from "../lib/adminApi";
import { bridgeAuthLoss, type Toast } from "./adminCrud";
import { assertNever } from "../lib/assertNever";

export type { Toast };

/**
 * Mission unlock-code store (SIM-42). A read machine mirroring quizContent.store (epoch
 * supersession on the READS, one-shot `bridged` → handleAuthLoss, a StrictMode "loaded once"
 * guard), plus a single ROTATE mutation. Rotate-only: no create/delete. Last-write-wins (no CAS).
 * Race-hardening that MUST hold (same as quiz):
 *
 *   - mutation-in-flight lives INSIDE `ready` (`mutating`, carrying the `code` so the panel can
 *     show the busy indicator on the active row only); `ready` keeps `rows` visible while
 *     `refreshing` so the table never blinks;
 *   - ONE mutation gate blocks every row's rotate while a write (or its trailing refetch) is in flight;
 *   - each mutation snapshots `myEpoch = epoch` (NO ++) and gates its tail on `myEpoch === epoch`,
 *     so a result after dispose()/reset() is dropped (no zombie toast / reopened field);
 *   - `rotate` resolves to a boolean so the PANEL (which owns the edit draft) clears it only on a
 *     committed write — a failed rotate keeps the draft for retry;
 *   - a 503 is ambiguous (may have committed) → refetch, never assume-failed; a 401/403 provably
 *     did not commit (gate precedes the DB fn) → bridge to the auth gate.
 */
export type MissionMutating = { kind: "rotating"; code: string } | null;

export type MissionUiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; rows: MissionRow[]; refreshing: boolean; mutating: MissionMutating }
  | { status: "error" } // retryable (serviceUnavailable)
  | { status: "authLost" }; // passive; gate re-probe drives the transition

export type MissionContentStoreState = {
  state: MissionUiState;
  toast: Toast | null;
  /** Fetch the list ONCE (StrictMode-safe). Call from the mount effect. */
  load: () => void;
  /** Manual refetch (the error screen's retry). */
  retry: () => void;
  /** Rotate a reallife mission's redeem_code. Resolves true iff committed. */
  rotate: (code: string, redeemCode: string) => Promise<boolean>;
  /** Abort reads + reset to idle on unmount. */
  dispose: () => void;
};

let epoch = 0;
let currentAbort: AbortController | null = null; // READS only
let bridged = false; // one-shot auth-loss bridge latch (shared by read + rotate)
let loadedOnce = false; // StrictMode double-mount guard

function setToast(myEpoch: number, toast: Toast): void {
  if (myEpoch !== epoch) return;
  missionContentStore.setState({ toast });
}

/** Safety net: clear the mutation gate if still set under the same epoch (the normal exit is the
 * trailing refetch, which resets `mutating`). */
function clearMutating(myEpoch: number): void {
  if (myEpoch !== epoch) return;
  const s = missionContentStore.getState().state;
  if (s.status === "ready" && s.mutating !== null) {
    missionContentStore.setState({ state: { ...s, mutating: null } });
  }
}

function reset(): void {
  epoch++;
  currentAbort?.abort();
  currentAbort = null;
  bridged = false;
  loadedOnce = false;
  missionContentStore.setState({ state: { status: "idle" }, toast: null });
}

async function runList(opts: { refreshing: boolean }): Promise<void> {
  const myEpoch = ++epoch;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;

  const cur = missionContentStore.getState().state;
  if (opts.refreshing && cur.status === "ready") {
    missionContentStore.setState({
      state: { status: "ready", rows: cur.rows, refreshing: true, mutating: null },
    });
  } else {
    missionContentStore.setState({ state: { status: "loading" } });
  }

  const outcome = await listMissions(ac.signal);
  if (myEpoch !== epoch) return; // superseded / reset → drop

  switch (outcome.kind) {
    case "ok":
      bridged = false;
      missionContentStore.setState({
        state: { status: "ready", rows: outcome.data, refreshing: false, mutating: null },
      });
      break;
    case "serviceUnavailable":
      missionContentStore.setState({ state: { status: "error" } });
      break;
    case "unauthenticated":
    case "notAuthorized":
      handleAuthLoss(myEpoch);
      break;
    default:
      assertNever(outcome);
  }
}

async function runRotate(code: string, redeemCode: string): Promise<boolean> {
  const s0 = missionContentStore.getState().state;
  if (s0.status !== "ready" || s0.mutating !== null || s0.refreshing) return false;
  const myEpoch = epoch; // snapshot (NOT ++)
  missionContentStore.setState({ state: { ...s0, mutating: { kind: "rotating", code } } });
  try {
    const outcome = await rotateMissionCode(code, redeemCode);
    if (myEpoch !== epoch) return outcome.kind === "ok"; // zombie: dropped, but report commit truth
    switch (outcome.kind) {
      case "ok":
        setToast(myEpoch, { tone: "success", text: `Kode misi "${outcome.data.code}" dirotasi.` });
        void runList({ refreshing: true });
        return true;
      case "rejected":
        // The panel's maxLength={64} + the backend's Pydantic max_length reject an over-long
        // code at the boundary (generic 422) before the DB's too_long reason is reachable, so a
        // single generic message is correct — there is no reachable reason-specific branch here.
        setToast(myEpoch, { tone: "error", text: "Input ditolak server. Periksa isian." });
        return false;
      case "notFound":
        setToast(myEpoch, { tone: "error", text: "Misi tidak ditemukan — memuat ulang." });
        void runList({ refreshing: true });
        return false;
      case "serviceUnavailable":
        // Last-write-wins: the rotation MAY have committed — refetch for truth, keep the draft.
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

/** At most ONE gate re-probe per auth-loss (shared latch). We NEVER write the gate directly. */
function handleAuthLoss(myEpoch: number): void {
  bridgeAuthLoss({
    isBridged: () => bridged,
    setBridged: (v) => {
      bridged = v;
    },
    isCurrent: () => myEpoch === epoch,
    toAuthLost: () => missionContentStore.setState({ state: { status: "authLost" } }),
    toError: () => missionContentStore.setState({ state: { status: "error" } }),
  });
}

export const missionContentStore = createStore<MissionContentStoreState>()(() => ({
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

  rotate: (code, redeemCode) => runRotate(code, redeemCode),

  dispose: () => reset(),
}));

/** Test-only reset of module singletons. */
export function __resetMissionContentForTest(): void {
  epoch = 0;
  currentAbort = null;
  bridged = false;
  loadedOnce = false;
  missionContentStore.setState({ state: { status: "idle" }, toast: null });
}

export function useMissionContent<T>(selector: (s: MissionContentStoreState) => T): T {
  return useStore(missionContentStore, selector);
}
