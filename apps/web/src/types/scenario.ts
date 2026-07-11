export type ScenarioStatus = "AVAILABLE" | "COMING_SOON";

/** Visual tone for an evidence row value. Defaults to neutral (plain ink). */
export type EvidenceTone = "good" | "bad" | "neutral";

/** One record row shown in the "Periksa Bukti" panel. Static FE content. */
export type EvidenceItem = {
  label: string;
  value: string;
  tone?: EvidenceTone;
};

/** Static case-file content backing the "Periksa Bukti" panel. */
export type EvidenceContent = {
  /** Panel title (e.g. "Periksa Bukti"). */
  title: string;
  /** Optional eyebrow/framing line (e.g. "BERKAS PERKARA — Pak Joko"). */
  eyebrow?: string;
  items: readonly EvidenceItem[];
};

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
  /**
   * Persona names when a scenario stages MORE THAN ONE NPC on screen at once
   * (RAT: Pak Darma & Ibu Sri). Presence + length ≥ 2 is the capability that
   * switches the session overlay to its multi-character layout. Names must match
   * the transcript `name` labels so the active speaker highlights correctly.
   */
  npcNames?: readonly string[];
  /** One-line briefing blurb shown in the in-session Deskripsi panel. */
  blurb?: string;
  /** One-line mission goal for the Deskripsi panel. */
  mission?: string;
  /** Concrete "what to do" steps, listed in the Deskripsi panel. */
  steps?: readonly string[];
  /**
   * When true, the end-session action stays disabled until the scenario's goal
   * signal (session store `goalReached`) fires. Scenarios without a discrete
   * goal signal leave this false → end is available once the agent is ready.
   */
  gatesEndOnGoal?: boolean;
  /** Label for the end-session rail button. Defaults to "Keputusan Akhir". */
  endActionLabel?: string;
  /**
   * When present, the scenario exposes a "Periksa Bukti" panel with this static
   * content. Presence is the capability — absent → no evidence button.
   */
  evidence?: EvidenceContent;
};
