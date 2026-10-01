/**
 * Null-safe transport between the game store and the Supabase progress RPCs. Every
 * method returns a discriminated RepoResult so the store handles each outcome at
 * compile time — crucially, `degraded` (no client / offline) is data, not an
 * exception, so it never collapses into the rpc-error rollback path.
 *
 * This module is a dumb typed adapter: all optimistic / epoch-guard / rollback logic
 * lives in game.store. Keeping it in lib/ preserves the stores → lib dependency
 * direction.
 */
import { supabase } from "./supabase";
import type { EndingType, FinalDecisionTrigger, ScenarioId } from "../session/transport/contract";
import {
  parseClaimMission,
  parseMyProgress,
  parseQuizCatalog,
  parseReconcile,
  parseRecordSession,
  parseRedeemVoucher,
  parseSubmitQuiz,
  type ClaimMissionResult,
  type MyProgress,
  type QuizAnswer,
  type QuizCatalogQuestion,
  type ReconcileResult,
  type RecordSessionResult,
  type RedeemVoucherResult,
  type SubmitQuizResult,
} from "./progressRepo.contracts";

export type RepoResult<T> =
  | { status: "ok"; data: T }
  | { status: "degraded" } // supabase === null → keep local, do NOT roll back
  | { status: "rpcError"; error: unknown } // RPC failed → roll back the optimistic delta
  | { status: "invalid"; raw: unknown }; // RPC returned an unexpected shape

function settle<T>(
  data: unknown,
  error: unknown,
  parse: (u: unknown) => T | null,
): RepoResult<T> {
  if (error) return { status: "rpcError", error };
  const parsed = parse(data);
  return parsed ? { status: "ok", data: parsed } : { status: "invalid", raw: data };
}

export const progressRepo = {
  async getMyProgress(): Promise<RepoResult<MyProgress>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("get_my_progress");
    return settle(data, error, parseMyProgress);
  },

  async fetchQuiz(): Promise<RepoResult<QuizCatalogQuestion[]>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase
      .from("quiz_catalog")
      .select("code, prompt, options")
      .order("sort_order");
    return settle(data, error, parseQuizCatalog);
  },

  async claimMission(missionId: string, code?: string): Promise<RepoResult<ClaimMissionResult>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("claim_mission", {
      p_mission_id: missionId,
      p_code: code ?? null,
    });
    return settle(data, error, parseClaimMission);
  },

  async redeemVoucher(voucherId: string): Promise<RepoResult<RedeemVoucherResult>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("redeem_voucher", { p_voucher_id: voucherId });
    return settle(data, error, parseRedeemVoucher);
  },

  async submitQuiz(answers: QuizAnswer[]): Promise<RepoResult<SubmitQuizResult>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("submit_quiz", { p_answers: answers });
    return settle(data, error, parseSubmitQuiz);
  },

  async reconcile(uid: string, xp: number, missions: string[]): Promise<RepoResult<ReconcileResult>> {
    if (!supabase) return { status: "degraded" };
    // point is intentionally not migrated — see reconcile_local_progress.
    const { data, error } = await supabase.rpc("reconcile_local_progress", {
      p_uid: uid,
      p_xp: xp,
      p_missions: missions,
    });
    return settle(data, error, parseReconcile);
  },

  async syncBadges(codes: string[]): Promise<RepoResult<null>> {
    if (!supabase) return { status: "degraded" };
    if (codes.length === 0) return { status: "ok", data: null };
    const { error } = await supabase.rpc("sync_badges", { p_codes: codes });
    return error ? { status: "rpcError", error } : { status: "ok", data: null };
  },

  // — session persistence (SIM-6) ——————————————————————————————————————————
  // NOTE: temporarily colocated here to stay independent of SIM-7 (session-history
  // read side), which introduces lib/sessionsRepo.ts. Relocate once SIM-7 lands so
  // session read + write live together. No optimistic delta / rollback — persistence
  // is a best-effort side-channel (see sessionController).

  /** Atomically insert + finalize a completed session via the record_session RPC.
   * `{ok:false,reason}` is valid data, not an error — the caller inspects the outcome.
   * user_id is attributed server-side from auth.uid(); no client identity is sent. */
  async recordSession(input: {
    scenarioId: ScenarioId;
    trigger: FinalDecisionTrigger;
    endingType: EndingType;
    scores: Record<string, number>;
    state: Record<string, string>;
    feedback: string;
    startedAt?: string | null;
  }): Promise<RepoResult<RecordSessionResult>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("record_session", {
      p_scenario_id: input.scenarioId,
      p_trigger: input.trigger,
      p_ending_type: input.endingType,
      p_scores: input.scores,
      p_state: input.state,
      p_feedback: input.feedback,
      p_started_at: input.startedAt ?? null,
    });
    return settle(data, error, parseRecordSession);
  },
};
