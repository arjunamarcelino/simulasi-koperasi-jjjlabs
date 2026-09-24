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
import { settle, type RepoResult } from "./repoResult";
import {
  parseClaimMission,
  parseMyProgress,
  parseQuizCatalog,
  parseReconcile,
  parseRedeemVoucher,
  parseSubmitQuiz,
  type ClaimMissionResult,
  type MyProgress,
  type QuizAnswer,
  type QuizCatalogQuestion,
  type ReconcileResult,
  type RedeemVoucherResult,
  type SubmitQuizResult,
} from "./progressRepo.contracts";

// Re-exported so existing importers (e.g. game.store) keep their `progressRepo` import path.
export type { RepoResult };

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
};
