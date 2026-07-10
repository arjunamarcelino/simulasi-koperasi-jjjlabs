/** Type-safe Phaser scene keys. */
export const SceneKey = {
  Boot: "Boot",
  Preload: "Preload",
  Village: "Village",
  VillageHud: "VillageHud",
  KoperasiInterior: "KoperasiInterior",
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
