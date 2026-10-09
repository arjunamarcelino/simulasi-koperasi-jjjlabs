/**
 * Pure helpers for the per-pillar score distribution (SIM-16). Kept out of the JSX component
 * so the bar math + aria text are unit-testable in the node-env vitest (no DOM).
 * Buckets are the 5 inclusive bands 0–20 / 21–40 / 41–60 / 61–80 / 81–100.
 */
export const BUCKET_LABELS = ["0–20", "21–40", "41–60", "61–80", "81–100"] as const;

/** Bar pixel heights proportional to the tallest bucket, within `maxPx`. All-zero buckets →
 * all-zero heights (the caller renders an empty state instead of invisible 0px bars). Never NaN. */
export function barHeightsPx(buckets: number[], maxPx: number): number[] {
  const max = Math.max(0, ...buckets);
  if (max <= 0) return buckets.map(() => 0);
  return buckets.map((c) => Math.round((Math.max(0, c) / max) * maxPx));
}

/** One enumerated aria-label covering all 5 buckets — the "table-view twin" for N=5, so the
 * chart is fully described to assistive tech without a separate table toggle. */
export function bucketsAriaLabel(pillarKey: string, buckets: number[]): string {
  const parts = BUCKET_LABELS.map((l, i) => `${l}: ${buckets[i] ?? 0} sesi`);
  return `Distribusi skor ${pillarKey} — ${parts.join("; ")}`;
}
