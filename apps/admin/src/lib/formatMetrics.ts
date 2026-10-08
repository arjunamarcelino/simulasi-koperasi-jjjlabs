/**
 * Display formatting for dashboard metrics, Indonesian locale (SIM-15).
 * `null` means "undefined / no data" → renders as an em dash.
 */
const EMPTY = "—";

const idInt = new Intl.NumberFormat("id-ID");
const idScore = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Integer counts: `1234567 → "1.234.567"` (id-ID groups with "."). */
export function count(n: number): string {
  return idInt.format(n);
}

/** Rate fraction [0,1] → whole-percent string, or "—". Deterministic rounding (locale-proof;
 * avoids Intl percent's NBSP / half-expand quirks). `0.8667 → "87%"`. */
export function pct(x: number | null): string {
  return x === null ? EMPTY : `${Math.round(x * 100)}%`;
}

/** Score 0–100 → one decimal in id-ID (comma decimal): `71.4 → "71,4"`, or "—".
 * NOT `toFixed` (which emits a dot that clashes with id-ID's "." thousands separator). */
export function score(x: number | null): string {
  return x === null ? EMPTY : idScore.format(x);
}
