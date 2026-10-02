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
import type { BadgeCriteria } from "@simkop/catalog";

export type { BadgeIconKind, BadgeCriteria, Badge } from "@simkop/catalog";
export { BADGES } from "@simkop/catalog";

export type BadgeContext = {
  xp: number;
  level: number;
  point: number;
  completedMissionIds: readonly string[];
  voucherCount: number;
  goodEndingScenarioIds: readonly string[];
};

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
    default: {
      // Exhaustiveness guard: a new BadgeCriteria kind fails to compile here.
      const _exhaustive: never = criteria;
      return _exhaustive;
    }
  }
}
