/**
 * Null-safe transport for the in-game mading leaderboard. Reads the latest season
 * snapshot via the public.leaderboard_current() RPC (SECURITY DEFINER, granted
 * anon/authenticated) and narrows the unvalidated Json at the boundary.
 *
 * Kept as its own repo (not bolted onto progressRepo): the mading is an independent
 * read surface and must not pull the progress contracts into its call graph. Mirrors
 * the progressRepo adapter shape — `degraded` (no client) is data, not an exception.
 */
import { supabase } from "./supabase";
import { settle, type RepoResult } from "./repoResult";
import { parseLeaderboardCurrent, type LeaderboardRow } from "./progressRepo.contracts";

export type { RepoResult, LeaderboardRow };

export const leaderboardRepo = {
  /** Latest-season top-20 standings for the mading. Empty array (`ok` + length 0) is
   * the valid "no season yet" / "season has no entries" state — distinct from `degraded`. */
  async current(): Promise<RepoResult<LeaderboardRow[]>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("leaderboard_current");
    return settle(data, error, parseLeaderboardCurrent);
  },
};
