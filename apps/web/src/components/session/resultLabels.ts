/* ------------------------------------------------------------------------- *
 * Human labels for AI Auditor result maps. The wire types (stateClassification,
 * scores) are open Record<string,…> because the values are LLM-generated JSON —
 * never cast them to unions. These are lookup tables with a visible fallback so
 * an unmapped value degrades to its raw string (not a blank), and a new backend
 * enum shows up rather than silently vanishing.
 * ------------------------------------------------------------------------- */

/** Visual tone for a classification chip. We own this union; the wire does not. */
export type Tone = "good" | "bad" | "warn" | "neutral";

/** Human label for a state-classification KEY (e.g. "State_Analisis_Masalah"). */
const STATE_KEY_LABELS: Record<string, string> = {
  State_Analisis_Masalah: "Analisis Masalah",
  State_Jalur_Remedi: "Jalur Remedi",
  State_Verifikasi_Data: "Verifikasi Data",
  State_Relasi_NPC: "Relasi Pengurus",
};

/** Label + tone for a state-classification VALUE. Partial by design — these are
 *  the values the backend prompt asks gpt to emit, not a guarantee. */
const STATE_VALUE_LABELS: Record<string, { label: string; tone: Tone }> = {
  BENAR: { label: "Benar", tone: "good" },
  SESUAI: { label: "Sesuai Prosedur", tone: "good" },
  SALAH: { label: "Salah", tone: "bad" },
  MELANGGAR_PROSEDUR: { label: "Melanggar Prosedur", tone: "bad" },
  NAIF: { label: "Terlalu Naif", tone: "warn" },
  DIBERSIHKAN: { label: "Data Dibersihkan", tone: "good" },
  DIBIARKAN: { label: "Data Dibiarkan", tone: "bad" },
  TERJAGA: { label: "Relasi Terjaga", tone: "good" },
  RUSAK: { label: "Relasi Rusak", tone: "bad" },
};

/** Human label for a score KEY (e.g. "member_centric"). */
const SCORE_KEY_LABELS: Record<string, string> = {
  member_centric: "Member-Centric",
  compliance: "Kepatuhan",
  soft_skills: "Diplomasi",
  integritas_data: "Integritas Data",
};

/** "State_Jalur_Remedi" / "member_centric" → "Jalur Remedi" / "member centric". */
function prettifyKey(raw: string): string {
  return raw.replace(/^State_/, "").replace(/[_-]+/g, " ").trim();
}

export type StateChip = {
  keyLabel: string;
  valueLabel: string;
  tone: Tone;
  /** False when the value wasn't in our map — UI can flag the fallback. */
  known: boolean;
};

export function resolveStateChip(key: string, value: string): StateChip {
  const v = STATE_VALUE_LABELS[value];
  return {
    keyLabel: STATE_KEY_LABELS[key] ?? prettifyKey(key),
    valueLabel: v?.label ?? value,
    tone: v?.tone ?? "neutral",
    known: v != null,
  };
}

export function resolveScoreLabel(key: string): string {
  return SCORE_KEY_LABELS[key] ?? prettifyKey(key);
}

/** Threshold color for a 0-100 score, reusing the game's good/warn/bad triad. */
export function scoreTone(score: number): Tone {
  if (score >= 70) return "good";
  if (score >= 40) return "warn";
  return "bad";
}
