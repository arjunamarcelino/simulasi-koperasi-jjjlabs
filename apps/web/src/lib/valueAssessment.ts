/**
 * Boundary parser for ICA value assessments (personal feedback). Shared by the live
 * auditor payload (LiveKit) and persisted rows (`sessions.values_json`) so both paths
 * narrow the same way: the UI renders closed unions, so an entry outside them is
 * dropped here instead of cast through (mirrors the parseSessionList skip-not-fail rule).
 */
import type { ValueAssessment, ValueStatus, ValueTrend } from "../session/transport/contract";
import { isRecord, str } from "./parseGuards";

// Record<…, true> guard tables fail to compile if the contract adds a member.
const STATUSES: Record<ValueStatus, true> = { TERCERMIN: true, BELUM_TAMPAK: true, DIABAIKAN: true };
const TRENDS: Record<ValueTrend, true> = {
  MENGUAT: true,
  TETAP: true,
  MELEMAH: true,
  BARU_DIUJI: true,
};

const has = (table: object, u: unknown): boolean =>
  typeof u === "string" && Object.prototype.hasOwnProperty.call(table, u);

/** jsonb/wire → value map. Non-object → {}; bad entries are skipped, not fatal. */
export function parseValueAssessments(u: unknown): Record<string, ValueAssessment> {
  if (!isRecord(u)) return {};
  const out: Record<string, ValueAssessment> = {};
  for (const [key, item] of Object.entries(u)) {
    if (!isRecord(item) || !has(STATUSES, item["status"]) || !has(TRENDS, item["trend"])) continue;
    out[key] = {
      status: item["status"] as ValueStatus,
      evidence: str(item["evidence"]) ?? "",
      trend: item["trend"] as ValueTrend,
    };
  }
  return out;
}
