/**
 * Pure wire helpers for the LiveKit transport (no livekit-client import, so they test in
 * node). Wire contract: apps/backend/CONTRACT.md §2 (POST /token) and §5 (AuditorResult).
 */
import { parseValueAssessments } from "../../../lib/valueAssessment";
import type { AuditorResult, ScenarioId, ValueHistoryEntry } from "../contract";

/**
 * How long the player waits for the end_session RPC (the AI Auditor's result). LiveKit also
 * CANCELS the worker's handler at this deadline, so it must outlast the auditor's whole
 * retry + fallback-model budget (`_AUDIT_BUDGET_S` in apps/backend/voice_worker/evaluation/
 * auditor.py) — pinned by wire.test.ts. livekit-client's default (15 s) is too short.
 */
export const END_SESSION_RPC_TIMEOUT_MS = 60_000;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Narrow an untrusted LiveKit payload to AuditorResult. The core envelope is required;
 * the personal-feedback fields are normalized (absent/malformed → empty) so a result
 * from an older worker — or a degraded audit — still renders instead of erroring.
 */
export function parseAuditorResult(x: unknown): AuditorResult | null {
  if (
    !isRecord(x) ||
    typeof x["trigger"] !== "string" ||
    typeof x["endingType"] !== "string" ||
    typeof x["narrativeFeedback"] !== "string" ||
    !isRecord(x["scores"]) ||
    !isRecord(x["stateClassification"])
  ) {
    return null;
  }
  const core = x as unknown as AuditorResult;
  return {
    ...core,
    values: parseValueAssessments(x["values"]),
    progressFeedback: typeof x["progressFeedback"] === "string" ? x["progressFeedback"] : "",
    nextStep: typeof x["nextStep"] === "string" ? x["nextStep"] : "",
    evaluationFailed: x["evaluationFailed"] === true,
  };
}

/** POST /token body. `history` only travels when there is some (older servers ignore it). */
export function tokenRequestBody(
  scenarioId: ScenarioId,
  history: readonly ValueHistoryEntry[],
): { scenario_id: ScenarioId; history?: readonly ValueHistoryEntry[] } {
  return history.length > 0 ? { scenario_id: scenarioId, history } : { scenario_id: scenarioId };
}
