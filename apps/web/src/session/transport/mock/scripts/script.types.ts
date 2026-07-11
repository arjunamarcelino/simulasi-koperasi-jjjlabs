import type { AuditorResult } from "../../contract";

export type ScriptTurn = {
  /** Persona label shown in the transcript. */
  name: string;
  text: string;
};

/**
 * Mock drift simulation (PRD §6 Layer 2). Not NLU — keyword matching only.
 * Enough to validate the UI: level rises on repeated repressive input, falls on
 * empathetic turns.
 */
export type DriftConfig = {
  escalate: readonly string[];
  deescalate: readonly string[];
  level1At: number;
  level2At: number;
};

export type Persona = { key: string; name: string };

/** One RAT phase (PRD §7.4). */
export type RatPhaseDef = {
  id: 1 | 2 | 3;
  label: string;
  advanceActionLabel: string | null;
  entryEvent?: { personaKey: string; text: string };
  turns: Record<string, readonly string[]>;
};

/** RAT-only config — two NPCs + a phase state machine. */
export type RatConfig = {
  personas: readonly Persona[];
  defaultPersonaKey: string;
  phaseDefaultPersona?: Partial<Record<1 | 2 | 3, string>>;
  nameMentions: Record<string, string>;
  phases: readonly RatPhaseDef[];
};

export type ScenarioScript = {
  greeting: ScriptTurn;
  npcTurns: readonly ScriptTurn[];
  hints?: readonly string[];
  drift?: DriftConfig;
  forceQuitLine?: ScriptTurn;
  rat?: RatConfig;
  /**
   * Index into `npcTurns` whose completion means the scenario goal is reached
   * (mirrors the backend `goal_reached` signal). Once that turn finishes
   * streaming, the transport fires onGoalReached. Omit for scenarios without a
   * discrete goal beat.
   */
  goalAtTurn?: number;
  endings: {
    good: AuditorResult;
    bad?: AuditorResult;
  };
};
