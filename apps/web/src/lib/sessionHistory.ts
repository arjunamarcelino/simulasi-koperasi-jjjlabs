/**
 * Pure domain logic for the session-history tab: reassembling a stored row into the
 * shape ResultPanel wants, ranking a scenario's best attempt, and grouping attempts by
 * scenario. No supabase / store / React imports — kept pure so its tests need no mocks.
 */
import { SCENARIOS } from "@simkop/catalog";
import type { SessionEnded } from "../session/transport/contract";
import type { SessionRecord } from "./sessionsRepo.contracts";

export type ScenarioHistory = {
  scenarioId: string;
  title: string; // from @simkop/catalog, or the raw code as a non-crash fallback
  best: SessionRecord; // groups always carry ≥1 attempt
  attempts: SessionRecord[]; // newest-first
};

// Catalog lookups: title + display order. Unknown ids fall back to the raw code and sort last.
const TITLE_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s.title]));
const ORDER_BY_ID = new Map(SCENARIOS.map((s, i) => [s.id, i]));

const ENDING_RANK: Record<SessionRecord["endingType"], number> = { good: 2, neutral: 1, bad: 0 };

/** Total rubric score for an attempt (sum of scores_json values). */
export const sumScores = (r: SessionRecord): number =>
  Object.values(r.scores).reduce((a, b) => a + b, 0);

/** True when the attempt carries any pillar score (false for tutorial rows). */
export const hasScores = (r: SessionRecord): boolean => Object.keys(r.scores).length > 0;

/** Reassemble a stored row into a SessionEnded so ResultPanel renders it like a live result. */
export function toSessionEnded(r: SessionRecord): SessionEnded {
  return {
    trigger: r.trigger,
    result: {
      scenarioId: r.scenarioId,
      trigger: r.trigger,
      stateClassification: r.stateClassification,
      scores: r.scores,
      endingType: r.endingType,
      narrativeFeedback: r.narrativeFeedback,
    },
  };
}

/**
 * The "best" attempt: best ending (good > neutral > bad), then highest total score, then
 * most recent, then lowest id (deterministic final tiebreak). The non-empty tuple type
 * encodes groupByScenario's invariant so there is no impossible empty branch.
 */
export function rankBestResult(attempts: readonly [SessionRecord, ...SessionRecord[]]): SessionRecord {
  return attempts.reduce((best, cur) => (isBetter(cur, best) ? cur : best));
}

function isBetter(a: SessionRecord, b: SessionRecord): boolean {
  const er = ENDING_RANK[a.endingType] - ENDING_RANK[b.endingType];
  if (er !== 0) return er > 0;
  const sc = sumScores(a) - sumScores(b);
  if (sc !== 0) return sc > 0;
  if (a.startedAt !== b.startedAt) return a.startedAt > b.startedAt;
  return a.id < b.id; // stable, deterministic
}

/** Group finalized attempts by scenario (attempts newest-first, groups in catalog order). */
export function groupByScenario(records: SessionRecord[]): ScenarioHistory[] {
  const buckets = new Map<string, SessionRecord[]>();
  for (const r of records) {
    const bucket = buckets.get(r.scenarioId);
    if (bucket) bucket.push(r);
    else buckets.set(r.scenarioId, [r]);
  }

  const groups: ScenarioHistory[] = [];
  for (const [scenarioId, attempts] of buckets) {
    attempts.sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    groups.push({
      scenarioId,
      title: TITLE_BY_ID.get(scenarioId) ?? scenarioId,
      best: rankBestResult(attempts as [SessionRecord, ...SessionRecord[]]),
      attempts,
    });
  }

  const orderOf = (id: string): number => ORDER_BY_ID.get(id) ?? Number.POSITIVE_INFINITY;
  groups.sort(
    (a, b) =>
      orderOf(a.scenarioId) - orderOf(b.scenarioId) ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
  );
  return groups;
}
