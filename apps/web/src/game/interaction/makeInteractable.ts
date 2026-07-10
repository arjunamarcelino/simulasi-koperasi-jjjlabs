import Phaser from "phaser";

/**
 * The click/pointer interaction seam, used by `VillageScene`'s koperasi door.
 * With character movement, walkable scenes drive interaction by proximity + E
 * instead: that logic lives inline in the scene's `update()` loop (see the
 * station handling in `KoperasiInteriorScene`), not here. Keep this for pointer
 * zones; callers pass the same `onFire` action.
 */
export function makeInteractable(
  target: Phaser.GameObjects.Zone | Phaser.GameObjects.Rectangle,
  onFire: () => void,
): void {
  target.setInteractive({ useHandCursor: true });
  target.on(Phaser.Input.Events.POINTER_DOWN, onFire);
}
