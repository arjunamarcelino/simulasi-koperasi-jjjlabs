/**
 * Null-safe read adapter for the authenticated user's session history. A dumb typed
 * adapter (mirrors progressRepo): owner-select RLS scopes rows to auth.uid(), so no
 * client-side user_id filter is needed. Read-only — the write path is SIM-6.
 */
import { supabase } from "./supabase";
import { settle, type RepoResult } from "./repoResult";
import { parseSessionList, type SessionRecord } from "./sessionsRepo.contracts";

const COLUMNS =
  "id, scenario_id, started_at, ended_at, trigger, ending_type, scores_json, state_json, narrative_feedback";

export const sessionsRepo = {
  /** Finalized attempts (ended_at not null), newest-first. RLS scopes to the caller. */
  async listMySessions(): Promise<RepoResult<SessionRecord[]>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase
      .from("sessions")
      .select(COLUMNS)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false });
    return settle(data, error, parseSessionList);
  },
};
