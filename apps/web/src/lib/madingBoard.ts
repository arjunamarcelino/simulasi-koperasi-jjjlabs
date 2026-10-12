/**
 * Shared helpers for the mading hub boards (SIM-18). Extracted so the three boards don't each carry
 * a byte-identical copy (review P3).
 */
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
