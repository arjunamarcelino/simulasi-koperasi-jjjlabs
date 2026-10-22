/**
 * Badge / achievement catalog. The catalog data + its shape types (`Badge`,
 * `BadgeIconKind`, `BadgeCriteria`) live in the shared `@simkop/catalog` package
 * (also mirrored into the DB seed); this module re-exports them and keeps the
 * FE-only runtime `BadgeContext` + the pure `isEarned` evaluator.
 *
 * Status is DERIVED real-time from store signals (no persistence) via
 * `isEarned(criteria, ctx)`: synchronous, reads only `ctx` — no store imports, no
 * Date.now(), no side effects. `criteria: null` marks a teaser (signal not yet
 * trackable); it always renders locked. `scenarioGoodEnding` reads
 * `ctx.goodEndingScenarioIds`, derived from session history (see sessionHistory.ts).
 */
import { BADGES, LEVELS, type BadgeCriteria } from "@simkop/catalog";

export type { BadgeIconKind, BadgeCriteria, Badge } from "@simkop/catalog";
export { BADGES } from "@simkop/catalog";

/** Content id of the knowledge micro-learning board. Shared by the board (which marks it
 * read via markKnowledgeRead) and the `contentRead` badge criteria in badges.json, so the
 * two can't silently drift — the parity test asserts a badge carries exactly this id. */
export const KNOWLEDGE_CONTENT_ID = "knowledge";

export type BadgeContext = {
  xp: number;
  level: number;
  point: number;
  completedMissionIds: readonly string[];
  voucherCount: number;
  goodEndingScenarioIds: readonly string[];
  /** Content ids whose micro-learning board has been fully read (e.g. "knowledge").
   * Session reads ∪ ids implied by already-earned contentRead badges — see
   * readContentIdsFromEarned. Powers the `contentRead` criteria. */
  readContentIds: readonly string[];
};

/** 1-based level from xp (mirrors the DB level_from_xp + ProfileModal's tier walk). */
function levelFromXp(xp: number): number {
  const safe = Math.max(0, xp);
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (safe >= LEVELS[i]!.minXp) index = i;
  return index + 1;
}

/**
 * The single place a BadgeContext is assembled from raw wallet signals — `level` is
 * derived from xp here so the profile render and the store sync can't drift. Pure.
 */
export function buildBadgeContext(input: {
  xp: number;
  point: number;
  completedMissionIds: readonly string[];
  voucherCount: number;
  goodEndingScenarioIds?: readonly string[];
  readContentIds?: readonly string[];
}): BadgeContext {
  return {
    xp: input.xp,
    level: levelFromXp(input.xp),
    point: input.point,
    completedMissionIds: input.completedMissionIds,
    voucherCount: input.voucherCount,
    goodEndingScenarioIds: input.goodEndingScenarioIds ?? [],
    readContentIds: input.readContentIds ?? [],
  };
}

/**
 * The content ids implied by a set of already-earned badge ids: for each earned
 * `contentRead` badge, its `contentId`. Lets the read set survive reload / cross-device
 * (the badge is the durable record) without hardcoding any badge id at the call sites —
 * callers union this with the live session reads. Mirrors how goodEndingScenarioIds
 * feeds scenarioGoodEnding.
 */
export function readContentIdsFromEarned(earnedBadgeIds: readonly string[]): string[] {
  const earned = new Set(earnedBadgeIds);
  const ids: string[] = [];
  for (const badge of BADGES) {
    if (badge.criteria?.kind === "contentRead" && earned.has(badge.id)) {
      ids.push(badge.criteria.contentId);
    }
  }
  return ids;
}

/** Pure: is this badge's criteria satisfied by the current context? */
export function isEarned(criteria: BadgeCriteria, ctx: BadgeContext): boolean {
  if (!criteria) return false;
  switch (criteria.kind) {
    case "level":
      return ctx.level >= criteria.min;
    case "point":
      return ctx.point >= criteria.min;
    case "voucherCount":
      return ctx.voucherCount >= criteria.min;
    case "missionCount":
      return ctx.completedMissionIds.length >= criteria.min;
    case "missionDone":
      return ctx.completedMissionIds.includes(criteria.missionId);
    case "scenarioGoodEnding":
      return ctx.goodEndingScenarioIds.includes(criteria.scenarioId);
    case "contentRead":
      return ctx.readContentIds.includes(criteria.contentId);
    default: {
      // Exhaustiveness guard: a new BadgeCriteria kind fails to compile here.
      const _exhaustive: never = criteria;
      return _exhaustive;
    }
  }
}
