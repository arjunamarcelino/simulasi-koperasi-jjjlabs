export type ScenarioStatus = "AVAILABLE" | "COMING_SOON";

/**
 * Display-level scenario contract for iteration-1 (foundation).
 * Gameplay fields (map keys, NPC ids, completion type, etc.) are added in a
 * later iteration when a scenario is actually playable.
 */
export type ScenarioConfig = {
  id: string;
  title: string;
  shortDescription: string;
  difficulty: string;
  status: ScenarioStatus;
  /** Persona name of the scenario's main NPC (shown in the session status bar). */
  npcName?: string;
  /** One-line briefing blurb shown in the in-session Deskripsi panel. */
  blurb?: string;
  /** One-line mission goal for the Deskripsi panel. */
  mission?: string;
  /** Concrete "what to do" steps, listed in the Deskripsi panel. */
  steps?: readonly string[];
};
