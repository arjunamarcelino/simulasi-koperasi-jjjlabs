/**
 * Mission catalog — the data + its types now live in the shared `@simkop/catalog`
 * package (also consumed by the DB seed generator), so the game and the database
 * cannot silently drift. This module re-exports them for the FE and keeps the
 * FE-only completed-ids guard.
 *
 * A reallife mission's unlock code is validated server-side by the `claim_mission`
 * RPC and lives only in apps/db (seed-codes.json) — it never ships in the client
 * bundle. The player types the code; the store forwards it to the server.
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
