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
import { supabase, type Json } from "./supabase";
import type { EndingType, FinalDecisionTrigger, ScenarioId } from "../session/transport/contract";
import {
  parseClaimMission,
  parseMyProgress,
  parseOpenSession,
  parseQuizCatalog,
  parseReconcile,
  parseRecordSession,
  parseRedeemVoucher,
  parseSubmitQuiz,
  type ClaimMissionResult,
  type MyProgress,
  type OpenSessionResult,
  type QuizAnswer,
  type QuizCatalogQuestion,
  type ReconcileResult,
  type RecordSessionOutcome,
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
  // read side), which introduces lib/sessionsRepo.ts. Relocate both methods there
  // once SIM-7 lands so session read + write live together. No optimistic delta /
  // rollback — persistence is a best-effort side-channel (see sessionController).

  /** Insert an OPEN session row (RLS insert-open) and return its id. */
  async openSession(scenarioId: ScenarioId): Promise<RepoResult<OpenSessionResult>> {
    if (!supabase) return { status: "degraded" };
    // uid is read from the Supabase client (the authedFetch precedent) — never from
    // auth.store, which would invert the stores → lib dependency direction.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user.id;
    if (!userId) return { status: "degraded" }; // not signed in → nothing to attribute
    const { data, error } = await supabase
      .from("sessions")
      .insert({ user_id: userId, scenario_id: scenarioId })
      .select("id")
      .single();
    return settle(data, error, parseOpenSession);
  },

  /** Finalize an open session via the RPC. `{ok:false,reason}` is valid data, not an
   * error — the caller inspects the discriminated outcome. */
  async recordSessionResult(input: {
    sessionId: string;
    trigger: FinalDecisionTrigger;
    endingType: EndingType;
    scores: Record<string, number>;
    state: Record<string, string>;
    feedback: string;
  }): Promise<RepoResult<RecordSessionOutcome>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("record_session_result", {
      p_session_id: input.sessionId,
      p_trigger: input.trigger,
      p_ending_type: input.endingType,
      p_scores: input.scores as Json,
      p_state: input.state as Json,
      p_feedback: input.feedback,
    });
    return settle(data, error, parseRecordSession);
  },
};
