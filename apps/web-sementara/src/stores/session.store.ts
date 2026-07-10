import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";
import type {
  ConnectionState,
  DriftLevel,
  PhaseState,
  ScenarioId,
  SessionEnded,
  TranscriptItem,
} from "../transport/contract.provisional";

export type View = "MENU" | "SESSION";

export type SessionState = {
  view: View;
  scenarioId: ScenarioId;
  connection: ConnectionState;
  transcript: TranscriptItem[];
  driftLevel: DriftLevel;
  phase: PhaseState | null;
  micEnabled: boolean;
  ended: SessionEnded | null;
  error: string | null;
  /** Petunjuk mentor terkini (fitur Petunjuk); null bila belum/di-tutup. */
  hint: string | null;
  /** True selagi menunggu petunjuk dari transport. */
  hintLoading: boolean;

  setView: (view: View) => void;
  setScenarioId: (id: ScenarioId) => void;
  setConnection: (state: ConnectionState) => void;
  upsertTranscript: (item: TranscriptItem) => void;
  setDriftLevel: (level: DriftLevel) => void;
  setPhase: (phase: PhaseState) => void;
  setMicEnabled: (enabled: boolean) => void;
  setEnded: (ended: SessionEnded) => void;
  setError: (message: string | null) => void;
  setHint: (hint: string | null) => void;
  setHintLoading: (loading: boolean) => void;
  reset: () => void;
};

const INITIAL = {
  connection: "idle",
  transcript: [],
  driftLevel: 0,
  phase: null,
  micEnabled: false,
  ended: null,
  error: null,
  hint: null,
  hintLoading: false,
} satisfies Partial<SessionState>;

/**
 * Read model tunggal untuk React. Ditulis hanya oleh sessionController.
 * Pola vanilla `createStore` + hook selector mengikuti apps/web/src/stores/game.store.ts.
 */
export const sessionStore = createStore<SessionState>()(
  subscribeWithSelector((set) => ({
    // view & scenarioId sengaja DI LUAR reset() — mengakhiri sesi tidak boleh
    // melempar pemain keluar dari skenario yang sedang/baru saja dipilih.
    view: "MENU",
    scenarioId: "tutorial-koperasi-konsumen",
    ...INITIAL,

    setView: (view) => set({ view }),
    setScenarioId: (scenarioId) => set({ scenarioId }),
    setConnection: (connection) => set({ connection }),

    // Partial streaming datang dengan id yang sama, jadi ini replace-by-id —
    // bukan append. Kalau di-append, satu kalimat NPC jadi puluhan bubble.
    upsertTranscript: (item) =>
      set((state) => {
        const index = state.transcript.findIndex((t) => t.id === item.id);
        if (index === -1) return { transcript: [...state.transcript, item] };
        const next = state.transcript.slice();
        next[index] = item;
        return { transcript: next };
      }),

    setDriftLevel: (driftLevel) => set({ driftLevel }),
    setPhase: (phase) => set({ phase }),
    setMicEnabled: (micEnabled) => set({ micEnabled }),
    setEnded: (ended) => set({ ended }),
    setError: (error) => set({ error }),
    setHint: (hint) => set({ hint }),
    setHintLoading: (hintLoading) => set({ hintLoading }),
    reset: () => set({ ...INITIAL }),
  })),
);

/** Selalu panggil dengan selector agar tidak re-render berlebihan. */
export function useSessionStore<T>(selector: (state: SessionState) => T): T {
  return useStore(sessionStore, selector);
}
