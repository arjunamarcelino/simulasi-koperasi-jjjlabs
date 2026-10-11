import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  deleteMadingBlock,
  listMading,
  upsertMadingBlock,
  type MadingGroups,
  type MadingUpsertInput,
} from "../lib/adminApi";
import { adminAuthStore } from "./adminAuth.store";
import { assertNever } from "../lib/assertNever";

/**
 * Mading content store (SIM-18). Same read machine + mutation discipline as quizContent.store
 * (epoch zombie-drop, one mutation gate, writes REFETCH rather than patch, `save` resolves a
 * boolean so the panel clears its form only on a committed write). Holds all boards grouped.
 */
export type MadingMutating = { kind: "saving" } | { kind: "deleting"; id: string } | null;

export type MadingUiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; groups: MadingGroups; refreshing: boolean; mutating: MadingMutating }
  | { status: "error" }
  | { status: "authLost" };

export type Toast = { tone: "success" | "error"; text: string };

export type MadingContentStoreState = {
  state: MadingUiState;
  toast: Toast | null;
  load: () => void;
  retry: () => void;
  save: (input: MadingUpsertInput) => Promise<boolean>;
  remove: (id: string) => void;
  dispose: () => void;
};

let epoch = 0;
let currentAbort: AbortController | null = null;
let bridged = false;
let loadedOnce = false;

function setToast(myEpoch: number, toast: Toast): void {
  if (myEpoch !== epoch) return;
  madingContentStore.setState({ toast });
}

function clearMutating(myEpoch: number): void {
  if (myEpoch !== epoch) return;
  const s = madingContentStore.getState().state;
  if (s.status === "ready" && s.mutating !== null) {
    madingContentStore.setState({ state: { ...s, mutating: null } });
  }
}

function reset(): void {
  epoch++;
  currentAbort?.abort();
  currentAbort = null;
  bridged = false;
  loadedOnce = false;
  madingContentStore.setState({ state: { status: "idle" }, toast: null });
}

async function runList(opts: { refreshing: boolean }): Promise<void> {
  const myEpoch = ++epoch;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;

  const cur = madingContentStore.getState().state;
  if (opts.refreshing && cur.status === "ready") {
    madingContentStore.setState({
      state: { status: "ready", groups: cur.groups, refreshing: true, mutating: null },
    });
  } else {
    madingContentStore.setState({ state: { status: "loading" } });
  }

  const outcome = await listMading(ac.signal);
  if (myEpoch !== epoch) return;

  switch (outcome.kind) {
    case "ok":
      bridged = false;
      madingContentStore.setState({
        state: { status: "ready", groups: outcome.data, refreshing: false, mutating: null },
      });
      break;
    case "serviceUnavailable":
      madingContentStore.setState({ state: { status: "error" } });
      break;
    case "unauthenticated":
    case "notAuthorized":
      handleAuthLoss(myEpoch);
      break;
    default:
      assertNever(outcome);
  }
}

async function runSave(input: MadingUpsertInput): Promise<boolean> {
  const s0 = madingContentStore.getState().state;
  if (s0.status !== "ready" || s0.mutating !== null || s0.refreshing) return false;
  const myEpoch = epoch;
  madingContentStore.setState({ state: { ...s0, mutating: { kind: "saving" } } });
  try {
    const outcome = await upsertMadingBlock(input);
    if (myEpoch !== epoch) return outcome.kind === "ok";
    switch (outcome.kind) {
      case "ok":
        setToast(myEpoch, { tone: "success", text: "Konten mading tersimpan." });
        void runList({ refreshing: true });
        return true;
      case "conflict":
        if (outcome.reason === "stale_write") {
          setToast(myEpoch, { tone: "error", text: "Data berubah di tempat lain — memuat ulang." });
          void runList({ refreshing: true });
        } else if (outcome.reason === "identitas_exists") {
          setToast(myEpoch, { tone: "error", text: "Identitas koperasi sudah ada (hanya satu)." });
        } else {
          setToast(myEpoch, { tone: "error", text: "Kunci blok sudah dipakai." });
        }
        return false;
      case "rejected":
        setToast(myEpoch, { tone: "error", text: "Input ditolak server. Periksa isian." });
        return false;
      case "notFound":
        setToast(myEpoch, { tone: "error", text: "Blok tidak ditemukan — memuat ulang." });
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

async function runRemove(id: string): Promise<void> {
  const s0 = madingContentStore.getState().state;
  if (s0.status !== "ready" || s0.mutating !== null || s0.refreshing) return;
  const myEpoch = epoch;
  madingContentStore.setState({ state: { ...s0, mutating: { kind: "deleting", id } } });
  try {
    const outcome = await deleteMadingBlock(id);
    if (myEpoch !== epoch) return;
    switch (outcome.kind) {
      case "ok":
      case "notFound":
        setToast(myEpoch, { tone: "success", text: "Blok mading dihapus." });
        void runList({ refreshing: true });
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

function handleAuthLoss(myEpoch: number): void {
  if (bridged) {
    madingContentStore.setState({ state: { status: "error" } });
    return;
  }
  bridged = true;
  madingContentStore.setState({ state: { status: "authLost" } });
  void (async () => {
    await adminAuthStore.getState().retry();
    if (myEpoch !== epoch) return;
    if (adminAuthStore.getState().gate.status === "authorized") {
      madingContentStore.setState({ state: { status: "error" } });
    }
  })();
}

export const madingContentStore = createStore<MadingContentStoreState>()(() => ({
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

  remove: (id) => {
    void runRemove(id);
  },

  dispose: () => reset(),
}));

/** Test-only reset of module singletons. */
export function __resetMadingContentForTest(): void {
  epoch = 0;
  currentAbort = null;
  bridged = false;
  loadedOnce = false;
  madingContentStore.setState({ state: { status: "idle" }, toast: null });
}

export function useMadingContent<T>(selector: (s: MadingContentStoreState) => T): T {
  return useStore(madingContentStore, selector);
}
