/* ------------------------------------------------------------------------- *
 * Human labels for AI Auditor result maps. The wire types (stateClassification,
 * scores) are open Record<string,…> because the values are LLM-generated JSON —
 * never cast them to unions. These are lookup tables with a visible fallback so
 * an unmapped value degrades to its raw string (not a blank), and a new backend
 * enum shows up rather than silently vanishing.
 * ------------------------------------------------------------------------- */

import type { EndingType } from "../../session/transport/contract";

/** Visual tone for a classification chip. We own this union; the wire does not. */
export type Tone = "good" | "bad" | "warn" | "neutral";

/**
 * Shared visual tokens per session ending — the single source for both `ResultPanel`
 * (panel accent + title color) and the history tab (row/group badge). Keeps the two from
 * drifting (e.g. neutral consistently maps to mustard).
 */
export const ENDING_STYLE: Record<
  EndingType,
  {
    /** Short badge label for a history row. */
    badgeLabel: string;
    /** Border-color token for the accent — pair with `border-t-4`. */
    accent: string;
    /** Panel title text color. */
    titleColor: string;
    /** Chip background + text for the history badge. */
    chip: string;
  }
> = {
  good: { badgeLabel: "Berhasil", accent: "border-forest", titleColor: "text-forest", chip: "bg-forest text-cream" },
  neutral: { badgeLabel: "Selesai", accent: "border-mustard", titleColor: "text-brown", chip: "bg-mustard text-ink" },
  bad: { badgeLabel: "Berakhir", accent: "border-orange", titleColor: "text-orange", chip: "bg-orange text-ink" },
};

/** Human label for a state-classification KEY (e.g. "State_Analisis_Masalah"). */
const STATE_KEY_LABELS: Record<string, string> = {
  State_Analisis_Masalah: "Analisis Masalah",
  State_Jalur_Remedi: "Jalur Remedi",
  State_Verifikasi_Data: "Verifikasi Data",
  State_Relasi_NPC: "Relasi Pengurus",
  State_Proses_Rapat: "Proses Rapat",
  State_Keabsahan_Keputusan: "Keabsahan Keputusan",
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
  TUNTAS: { label: "Rapat Tuntas", tone: "good" },
  BUBAR: { label: "Rapat Bubar", tone: "bad" },
  SAH_DEMOKRATIS: { label: "Sah & Demokratis", tone: "good" },
  TUNDUK_TEKANAN_MODAL: { label: "Tunduk Tekanan Modal", tone: "bad" },
  TIDAK_BERLAKU: { label: "Tidak Berlaku", tone: "warn" },
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
