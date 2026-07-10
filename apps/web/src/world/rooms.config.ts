import type { ScenarioStatus } from "../types/scenario";

/**
 * A room in the Koperasi interior. `position` is in Phaser world pixels and
 * doubles as the future collider/spawn geometry when movement is added.
 * `scenarioId` is a foreign key into SCENARIOS (null while a room has no scenario).
 */
export type Room = {
  id: string;
  label: string;
  position: { x: number; y: number; width: number; height: number };
  status: ScenarioStatus;
  scenarioId: string | null;
};

export const KOPERASI_ROOMS: readonly Room[] = [
  {
    id: "ruang-meeting",
    label: "Ruang Meeting",
    position: { x: 120, y: 230, width: 300, height: 300 },
    status: "AVAILABLE",
    scenarioId: "rapat-anggota-tahunan",
  },
  {
    id: "gudang",
    label: "Gudang",
    position: { x: 490, y: 230, width: 300, height: 300 },
    status: "COMING_SOON",
    scenarioId: null,
  },
  {
    id: "marketplace",
    label: "Marketplace",
    position: { x: 860, y: 230, width: 300, height: 300 },
    status: "COMING_SOON",
    scenarioId: null,
  },
];
