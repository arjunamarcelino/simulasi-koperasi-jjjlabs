import Phaser from "phaser";

/**
 * The interaction seam. v1 trigger = click. When character movement lands later,
 * swap the `pointerdown` wiring for proximity + key press in this one file —
 * callers pass the same `onFire` action and are untouched.
 */
export function makeInteractable(
  target: Phaser.GameObjects.Zone | Phaser.GameObjects.Rectangle,
  onFire: () => void,
): void {
  target.setInteractive({ useHandCursor: true });
  target.on(Phaser.Input.Events.POINTER_DOWN, onFire);
}
