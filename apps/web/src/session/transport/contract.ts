/* ------------------------------------------------------------------------- *
 * FE↔BE transport contract. The single seam between MockTransport (offline)
 * and LiveKitTransport (real backend). All UI is written against this interface
 * and never imports a concrete transport. Wire spec: apps/backend/CONTRACT.md.
 * ------------------------------------------------------------------------- */

export type ScenarioId =
  | "tutorial-koperasi-konsumen"
  | "kredit-macet"
  | "keanggotaan-fiktif"
  | "rapat-anggota-tahunan";

export type Speaker = "player" | "npc" | "system";

export type TranscriptItem = {
  id: string;
  speaker: Speaker;
  /** Persona label, e.g. "Ibu Rumah Tangga". Omitted for player/system. */
  name?: string;
  text: string;
  /** True while text is still streaming in chunk by chunk. */
  streaming: boolean;
  at: number;
};

/** PRD §6 Layer 2. Tutorial never leaves 0. */
export type DriftLevel = 0 | 1 | 2;

/** Meeting phase — RAT only (scenario 4). */
export type Phase = 1 | 2 | 3;

export type PhaseState = {
  phase: Phase;
  label: string;
  advanceActionLabel: string | null;
};

/** The three ways a session ends — PRD §6. */
export type FinalDecisionTrigger = "manual" | "sinyal_level_1" | "force_quit_level_2";

/**
 * AI Auditor result (PRD §6 Layer 3). For the tutorial this payload is scripted
 * (not gpt-generated); stateClassification/scores stay empty so one shape serves
 * both the tutorial and scored scenarios later.
 */
export type AuditorResult = {
  scenarioId: ScenarioId;
  trigger: FinalDecisionTrigger;
  stateClassification: Record<string, string>;
  scores: Record<string, number>;
  endingType: "good" | "bad" | "neutral";
  narrativeFeedback: string;
};

export type SessionEnded = {
  trigger: FinalDecisionTrigger;
  result: AuditorResult;
};

export type ConnectionState = "idle" | "connecting" | "connected" | "ended" | "error";

export type Unsubscribe = () => void;

export interface SessionTransport {
  /** Mint token + join room. Resolves once the NPC greeting is queued. */
  connect(scenarioId: ScenarioId): Promise<void>;

  /** A text turn from the player — the voice fallback path. */
  sendText(text: string): void;

  /** Request ONE contextual mentor hint (RPC `petunjuk` on LiveKit; scripted in mock). */
  requestHint(): Promise<string>;

  /** Toggle mic. No-op in mock; enables the mic track on LiveKit. */
  setMicEnabled(enabled: boolean): void;

  onTranscript(cb: (item: TranscriptItem) => void): Unsubscribe;
  onDriftLevel(cb: (level: DriftLevel) => void): Unsubscribe;
  onConnectionState(cb: (state: ConnectionState) => void): Unsubscribe;

  /**
   * Fires once the NPC agent is actually ready to receive RPCs. On LiveKit the
   * room reports "connected" ~12-19s before the agent joins, so the UI must gate
   * on THIS, not on connection === "connected". Mock fires it right after connect.
   */
  onAgentReady?(cb: () => void): Unsubscribe;

  /** Fires once when the session ends via any path. */
  onSessionEnded(cb: (ended: SessionEnded) => void): Unsubscribe;

  /** Player ends the session. The tutorial button sends "manual". */
  endSession(trigger?: FinalDecisionTrigger): void;

  /** Re-arm browser audio autoplay from a user gesture (LiveKit room.startAudio). */
  unlockAudio?(): void;

  /** Demo tool — force a drift level. Mock only. */
  debugSetDrift?(level: DriftLevel): void;

  /** Meeting phases — RAT only. */
  onPhase?(cb: (state: PhaseState) => void): Unsubscribe;

  /** Player performs an agenda action to advance one phase (RAT). */
  advancePhase?(): void;

  /** Tear down the room / cancel all timers. Idempotent. */
  disconnect(): Promise<void>;
}
