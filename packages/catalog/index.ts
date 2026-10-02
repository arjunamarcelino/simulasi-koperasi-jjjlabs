/**
 * @simkop/catalog — the single source of truth for Koperasi Simulator catalog
 * content. Both apps/web (UI) and apps/db (seed generator) consume THIS data, so
 * the game and the database can never silently drift.
 *
 * Data lives as JSON under ./data; this module types it. Shapes match the types
 * apps/web has always used, so the FE content modules re-export from here.
 */
import missionsJson from "./data/missions.json";
import vouchersJson from "./data/vouchers.json";
import badgesJson from "./data/badges.json";
import scenariosJson from "./data/scenarios.json";
import levelsJson from "./data/levels.json";

// — Missions —
export type MissionKind = "game" | "reallife";
export type MissionReward = { xp: number; point: number };
type MissionBase = { id: string; title: string; description: string; reward: MissionReward };
export type GameMission = MissionBase & { kind: "game" };
// Reallife unlock codes live server-side only (apps/db/seed-codes.json) and are validated
// by the claim_mission RPC — they must never ship in the client bundle. `code?: never`
// makes any attempt to read or set `mission.code` a compile error.
export type RealLifeMission = MissionBase & { kind: "reallife"; code?: never };
export type Mission = GameMission | RealLifeMission;

// — Vouchers —
export type Voucher = { id: string; name: string; cost: number; description?: string };

// — Badges —
export type BadgeIconKind =
  | "medal" | "book" | "ticket" | "compass" | "coin" | "flag" | "trophy" | "piggy" | "check";
export type BadgeCriteria =
  | { kind: "level"; min: number }
  | { kind: "point"; min: number }
  | { kind: "voucherCount"; min: number }
  | { kind: "missionCount"; min: number }
  | { kind: "missionDone"; missionId: string }
  | { kind: "scenarioGoodEnding"; scenarioId: string }
  | null; // teaser — signal not trackable yet
export type Badge = {
  id: string;
  title: string;
  requirement: string;
  icon: BadgeIconKind;
  criteria: BadgeCriteria;
};

// — Scenarios (identity/catalog subset; rich display config stays in apps/web) —
export type ScenarioStatus = "AVAILABLE" | "COMING_SOON";
export type ScenarioCatalogEntry = {
  id: string;
  title: string;
  difficulty: string;
  status: ScenarioStatus;
};

// — Level tiers (ascending; first tier MUST start at 0) —
export type LevelTier = { title: string; minXp: number };

// Bundle-leak tripwire: if any missions.json entry regains a `code`, its `string` is not
// assignable to `never` and this line fails `tsc` — the leak is caught at compile time,
// before any test runs. (`id` anchors the shape so a code-less object isn't a "weak type".)
missionsJson satisfies readonly { id: string; code?: never }[];
export const MISSIONS: readonly Mission[] = missionsJson as unknown as readonly Mission[];
export const VOUCHERS: readonly Voucher[] = vouchersJson as unknown as readonly Voucher[];
export const BADGES: readonly Badge[] = badgesJson as unknown as readonly Badge[];
export const SCENARIOS: readonly ScenarioCatalogEntry[] =
  scenariosJson as unknown as readonly ScenarioCatalogEntry[];
export const LEVELS: readonly LevelTier[] = levelsJson as unknown as readonly LevelTier[];
