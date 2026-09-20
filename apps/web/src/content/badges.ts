/**
 * Badge / achievement catalog. The catalog data + its shape types (`Badge`,
 * `BadgeIconKind`, `BadgeCriteria`) live in the shared `@simkop/catalog` package
 * (also mirrored into the DB seed); this module re-exports them and keeps the
 * FE-only runtime `BadgeContext` + the pure `isEarned` evaluator.
 *
 * Status is DERIVED real-time from store signals (no persistence) via
 * `isEarned(criteria, ctx)`: synchronous, reads only `ctx` — no store imports, no
 * Date.now(), no side effects. `criteria: null` marks a teaser (signal not yet
 * trackable, e.g. RAT score); it always renders locked.
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
  }
}
