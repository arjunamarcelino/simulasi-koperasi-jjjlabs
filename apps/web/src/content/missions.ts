/**
 * Mission catalog — the data + its types now live in the shared `@simkop/catalog`
 * package (also consumed by the DB seed generator), so the game and the database
 * cannot silently drift. This module re-exports them for the FE and keeps the
 * FE-only completed-ids guard.
 *
 * A reallife mission carries a `code` (soft gate — printed at the KDMP and typed
 * by the player; not a cryptographic secret). The discriminated union still makes
 * `code` compile-time-required for reallife missions.
 */
export type {
  MissionKind,
  MissionReward,
  GameMission,
  RealLifeMission,
  Mission,
} from "@simkop/catalog";
export { MISSIONS } from "@simkop/catalog";

/** Type guard for the persisted list of completed mission ids. */
export function isStringArray(u: unknown): u is string[] {
  return Array.isArray(u) && u.every((x) => typeof x === "string");
}
