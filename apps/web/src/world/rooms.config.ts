import type { ScenarioStatus } from "../types/scenario";

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
