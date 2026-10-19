/**
 * Shared helpers for the mading hub boards (SIM-18). Extracted so the three boards don't each carry
 * a byte-identical copy (review P3).
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { RepoResult } from "./repoResult";

/** The loading/degraded/error message for a board read, or null when the result is `ok`. */
export function fallbackMessage(result: RepoResult<unknown> | null): string | null {
  if (result === null) return "Memuat papan…";
  if (result.status === "degraded") return "Papan ini butuh koneksi internet.";
  if (result.status === "rpcError" || result.status === "invalid") return "Gagal memuat papan.";
  return null;
}

/** Wrap a carousel index into [0, len) (len 0 → 0). */
export const wrapIndex = (i: number, len: number): number => (len ? ((i % len) + len) % len : 0);

/**
 * True once every card has been visited (matched by `block_key`). The knowledge board
 * awards its reading badge on this. False for an empty card list — an empty / degraded /
 * error board (no cards) never counts as "read".
 */
export function allCardsSeen(
  visited: ReadonlySet<string>,
  cards: readonly { block_key: string }[],
): boolean {
  return cards.length > 0 && cards.every((c) => visited.has(c.block_key));
}

/**
 * The next carousel index for an arrow keydown, already wrapped — or `null` when the event must be
 * ignored: a non-arrow key, an auto-repeat (a held key would strobe the fade), an empty board, or a
 * keystroke aimed at an editable field (so nav never steals typing). Shared by both mading carousels
 * so the handler lives in one place; the caller preventDefault/stopPropagations only on a non-null
 * result. The Phaser scene disables its (global) keyboard while an overlay is open, so arrows can't
 * leak to the game behind the modal regardless.
 */
export function carouselArrowIndex(e: ReactKeyboardEvent, cur: number, len: number): number | null {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return null;
  if (e.repeat) return null;
  if (len === 0) return null;
  // `typeof` guard keeps this callable in the no-DOM test env; in the browser the field check holds.
  if (
    typeof HTMLElement !== "undefined" &&
    e.target instanceof HTMLElement &&
    e.target.closest("input, textarea, select, [contenteditable='true']")
  ) {
    return null;
  }
  return wrapIndex(cur + (e.key === "ArrowRight" ? 1 : -1), len);
}
