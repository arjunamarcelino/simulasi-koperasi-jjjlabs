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
} from "../session/transport/contract";

/** MENU/SESSION is vestigial here — apps/web navigation is driven by game.store's
 * View. Left in place (harmless) so the ported controller compiles unchanged. */
export type View = "MENU" | "SESSION";

export type SessionState = {
  view: View;
  scenarioId: ScenarioId;
  connection: ConnectionState;
  /** True once the NPC agent is ready for RPC (gate mic/text/final on THIS). */
  agentJoined: boolean;
  transcript: TranscriptItem[];
  driftLevel: DriftLevel;
  phase: PhaseState | null;
  micEnabled: boolean;
  ended: SessionEnded | null;
  error: string | null;
  hint: string | null;
  hintLoading: boolean;

  setView: (view: View) => void;
  setScenarioId: (id: ScenarioId) => void;
  setConnection: (state: ConnectionState) => void;
  setAgentJoined: (joined: boolean) => void;
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
  agentJoined: false,
  transcript: [],
  driftLevel: 0,
  phase: null,
  micEnabled: false,
  ended: null,
  error: null,
  hint: null,
  hintLoading: false,
} satisfies Partial<SessionState>;

/** Single read model for React. Written only by sessionController. */
export const sessionStore = createStore<SessionState>()(
  subscribeWithSelector((set) => ({
    view: "MENU",
    scenarioId: "tutorial-koperasi-konsumen",
    ...INITIAL,

    setView: (view) => set({ view }),
    setScenarioId: (scenarioId) => set({ scenarioId }),
    setConnection: (connection) => set({ connection }),
    setAgentJoined: (agentJoined) => set({ agentJoined }),

    // Partial streaming arrives with the same id → replace-by-id, not append.
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

/** Always call with a selector to avoid needless re-renders. */
export function useSessionStore<T>(selector: (state: SessionState) => T): T {
  return useStore(sessionStore, selector);
}
