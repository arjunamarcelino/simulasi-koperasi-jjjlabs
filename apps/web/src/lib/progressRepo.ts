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
import {
  parseClaimMission,
  parseMyProgress,
  parseReconcile,
  parseRedeemVoucher,
  parseSubmitQuiz,
  type ClaimMissionResult,
  type MyProgress,
  type QuizAnswer,
  type ReconcileResult,
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

  async reconcile(
    uid: string,
    xp: number,
    point: number,
    missions: string[],
  ): Promise<RepoResult<ReconcileResult>> {
    if (!supabase) return { status: "degraded" };
    const { data, error } = await supabase.rpc("reconcile_local_progress", {
      p_uid: uid,
      p_xp: xp,
      p_point: point,
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
