/**
 * Character sprite configs. Each describes a 16x16 spritesheet's walk frames per
 * direction. Left/right share the `side` frames and are mirrored via flipX, so
 * sheets that only draw one side (like the villager) work. Swap the player
 * character by passing a different config to `new Player(...)`.
 */
export type CharacterConfig = {
  key: string; // Phaser texture key (must match the spritesheet loaded in PreloadScene)
  path: string; // asset URL
  walk: {
    down: readonly number[];
    up: readonly number[];
    side: readonly number[]; // frames for the horizontal walk
  };
  sideFacesRight: boolean; // true if the `side` art faces right (else it faces left)
  frameRate?: number;
};

/** Regular villager (OpenGameArt "Man Sprite 16x16", CC0). 8-col sheet. */
export const VILLAGER: CharacterConfig = {
  key: "villager",
  path: "/assets/ninja/villager.png",
  walk: { down: [0, 1], up: [3, 17], side: [2, 10] },
  sideFacesRight: false,
  frameRate: 6,
};

/** Ninja Adventure samurai (CC0). 4-col sheet, rows = down/up/left/right. */
export const SAMURAI_GREEN: CharacterConfig = {
  key: "samurai",
  path: "/assets/ninja/samurai_green.png",
  walk: { down: [0, 1, 2, 3], up: [4, 5, 6, 7], side: [8, 9, 10, 11] },
  sideFacesRight: false, // the left-facing row; mirrored for right
  frameRate: 8,
};
