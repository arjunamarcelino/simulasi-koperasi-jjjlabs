/** Type-safe Phaser scene keys. */
export const SceneKey = {
  Boot: "Boot",
  Preload: "Preload",
  Village: "Village",
  KoperasiInterior: "KoperasiInterior",
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
