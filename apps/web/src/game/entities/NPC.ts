import Phaser from "phaser";
import type { CharacterConfig } from "./characters";

/**
 * A stationary, non-controllable NPC. Draws the idle (facing-down) frame of a
 * character sheet, y-sorted like the player, with an immovable body so the
 * player collides with it instead of walking through.
 */
export class NPC {
  readonly sprite: Phaser.Physics.Arcade.Sprite;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: CharacterConfig) {
    this.sprite = scene.physics.add.sprite(x, y, cfg.key, cfg.walk.down[0] ?? 0);
    this.sprite.setDepth(y);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setImmovable(true);
    body.moves = false;
  }
}
