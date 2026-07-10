import type { AuditorResult } from "../../contract.provisional";

export type ScriptTurn = {
  /** Label persona yang tampil di transkrip. */
  name: string;
  text: string;
};

/**
 * Simulasi drift untuk mock (PRD Bagian 6 Lapisan 2).
 *
 * Bukan NLU — sekadar pencocokan keyword. Cukup untuk memvalidasi UI: level
 * naik saat pemain konsisten represif, turun saat berbalik empatik.
 */
export type DriftConfig = {
  /** Keyword (lowercase) yang menaikkan skor tegangan. */
  escalate: readonly string[];
  /** Keyword (lowercase) yang menurunkan skor tegangan. */
  deescalate: readonly string[];
  /** Ambang skor untuk naik ke Level 1. */
  level1At: number;
  /** Ambang skor untuk naik ke Level 2 (force quit). */
  level2At: number;
};

export type Persona = { key: string; name: string };

/** Satu fase RAT (PRD §7.4). */
export type RatPhaseDef = {
  id: 1 | 2 | 3;
  /** Label agenda, mis. "Buka Rapat". */
  label: string;
  /** Label tombol yang memajukan ke fase berikutnya; null di fase terakhir. */
  advanceActionLabel: string | null;
  /** Diemit otomatis saat MASUK fase ini (mis. interupsi kasar Pak Darma). */
  entryEvent?: { personaKey: string; text: string };
  /** Baris per persona untuk fase ini; dikonsumsi berurutan per persona. */
  turns: Record<string, readonly string[]>;
};

/**
 * Konfigurasi khusus RAT — dua NPC + state machine fase. Hadir hanya di skenario
 * RAT; keberadaannya yang membuat MockTransport memakai alur multi-persona.
 */
export type RatConfig = {
  personas: readonly Persona[];
  /** Responder default bila tak ada override fase / penyebutan nama. */
  defaultPersonaKey: string;
  /** Override responder default per fase (mis. Fase 2 → Pak Darma). */
  phaseDefaultPersona?: Partial<Record<1 | 2 | 3, string>>;
  /** Keyword (lowercase) → personaKey; penyebutan nama memilih responden. */
  nameMentions: Record<string, string>;
  phases: readonly RatPhaseDef[];
};

export type ScenarioScript = {
  /** Diemit begitu connect() selesai. */
  greeting: ScriptTurn;
  /** Dikonsumsi satu per giliran pemain, berurutan (skenario linear). */
  npcTurns: readonly ScriptTurn[];
  /**
   * Petunjuk terskrip untuk fitur Petunjuk (mock). Dikonsumsi berurutan tiap
   * kali pemain menekan tombol; menetap di item terakhir. Absen → mock memberi
   * petunjuk generik. Di LiveKit petunjuk di-generate backend, bukan dari sini.
   */
  hints?: readonly string[];
  /** Absen → skenario tidak menjalankan observer (tutorial inert di L0). */
  drift?: DriftConfig;
  /** Baris NPC saat menutup diri di Level 2 sebelum force quit. */
  forceQuitLine?: ScriptTurn;
  /** Hadir → skenario memakai alur RAT (dua NPC + fase); npcTurns diabaikan. */
  rat?: RatConfig;
  /**
   * Hasil terskrip. `good` wajib; `bad` hadir untuk skenario ber-drift.
   * Mock memilih di antara keduanya berdasarkan jalur pemicu & level akhir.
   */
  endings: {
    good: AuditorResult;
    bad?: AuditorResult;
  };
};
