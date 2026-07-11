import type { ScenarioStatus } from "../types/scenario";
import type { ScenarioId } from "../session/transport/contract";

/** The interior sections. Union is the single source of truth for room ids. */
export type RoomId = "marketplace" | "kasir" | "gudang" | "ruang-meeting";

/**
 * A room (section) in the Koperasi interior. Pure data (no Phaser types) so it
 * stays importable from the React layer. Spatial geometry lives in the
 * KoperasiInteriorScene (stations), not here. `scenarioId` is a foreign key into
 * SCENARIOS (null while a room has no scenario).
 */
export type Room = {
  id: RoomId;
  label: string;
  status: ScenarioStatus;
  scenarioId: string | null;
};

export const KOPERASI_ROOMS: readonly Room[] = [
  {
    id: "marketplace",
    label: "Marketplace",
    status: "COMING_SOON",
    scenarioId: null,
  },
  {
    id: "kasir",
    label: "Kasir",
    status: "COMING_SOON",
    scenarioId: null,
  },
  {
    id: "gudang",
    label: "Gudang",
    status: "COMING_SOON",
    scenarioId: null,
  },
  {
    id: "ruang-meeting",
    label: "Ruang Rapat",
    status: "AVAILABLE",
    scenarioId: "rapat-anggota-tahunan",
  },
];

/**
 * How a chosen scenario is launched from the room's picker:
 * - "session" → in-map SESSION overlay (playable single-NPC, e.g. Pak Bambang).
 * - "game"    → full GAME view (RAT — still a stub until its mechanics land).
 */
export type ScenarioLaunch = "session" | "game";
export type RoomScenarioChoice = { scenarioId: ScenarioId; launch: ScenarioLaunch };

/**
 * Rooms that offer a CHOICE of scenarios render a picker instead of the single
 * confirm. Keyed by room id; only Ruang Rapat needs it today (RAT vs Keanggotaan
 * Fiktif). Kept local so the pure `Room` shape (and every other room) is untouched.
 * A card's enabled/locked state is read from the scenario's own `status`.
 */
export const ROOM_SCENARIO_CHOICES: Record<string, readonly RoomScenarioChoice[]> = {
  "ruang-meeting": [
    { scenarioId: "rapat-anggota-tahunan", launch: "game" },
    { scenarioId: "keanggotaan-fiktif", launch: "session" },
  ],
};
