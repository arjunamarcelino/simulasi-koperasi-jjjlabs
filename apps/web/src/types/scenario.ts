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
};
