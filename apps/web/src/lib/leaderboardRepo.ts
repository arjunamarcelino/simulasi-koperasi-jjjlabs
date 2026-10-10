/**
 * Null-safe transport for the in-game mading leaderboard. Reads the latest season
 * snapshot via the public.leaderboard_current() RPC (SECURITY DEFINER, granted
 * anon/authenticated) and narrows the unvalidated Json at the boundary.
 *
 * Kept as its own repo AND owning its own contract (type + parser live here, not in
 * progressRepo.contracts): the mading is an independent read surface that depends only on
 * the neutral parse guards, never on the progress contracts. Mirrors the progressRepo
 * adapter shape — `degraded` (no client) is data, not an exception.
 */
import { supabase } from "./supabase";
import { settle, type RepoResult } from "./repoResult";
import { isRecord, str } from "./parseGuards";

export type { RepoResult };

export type LeaderboardRow = { display_name: string; xp: number; level: number; rank: number };

const nonNegInt = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= 0;

/** Narrow the RPC's `Json` to rows. xp/level/rank must be non-negative integers (matching the
 * admin guard — a negative/float slips past a bare finiteness check), and ranks must be unique
 * since the mading uses `rank` as the React key. We never expect/read `user_id` (the RPC strips
 * it); an extra key is ignored (forward-compatible). Any violation → null (the repo maps it to
 * an `invalid` RepoResult). */
export function parseLeaderboardCurrent(u: unknown): LeaderboardRow[] | null {
  if (!Array.isArray(u)) return null;
  const out: LeaderboardRow[] = [];
  const ranks: number[] = [];
  for (const row of u) {
    if (!isRecord(row)) return null;
    const display_name = str(row["display_name"]);
    const xp = row["xp"];
    const level = row["level"];
    const rank = row["rank"];
    if (display_name === null || !nonNegInt(xp) || !nonNegInt(level) || !nonNegInt(rank)) return null;
    ranks.push(rank);
    out.push({ display_name, xp, level, rank });
  }
  if (new Set(ranks).size !== ranks.length) return null; // duplicate rank → bad React key
  return out;
}

export const leaderboardRepo = {
  /** Latest-season top-20 standings for the mading. Empty array (`ok` + length 0) is
   * the valid "no season yet" / "season has no entries" state — distinct from `degraded`. */
  async current(): Promise<RepoResult<LeaderboardRow[]>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("leaderboard_current");
    return settle(data, error, parseLeaderboardCurrent);
  },
};
