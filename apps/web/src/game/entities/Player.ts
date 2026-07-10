import Phaser from "phaser";
import { type CharacterConfig, SAMURAI_GREEN } from "./characters";
import { gameStore } from "../../stores/game.store";

const SPEED = 90;
type Dir = "down" | "up" | "left" | "right";

/**
 * Player character: an arcade-physics sprite with WASD/arrow movement and
 * config-driven 4-direction walk animations (left/right mirror the `side`
 * frames via flipX). Pass a CharacterConfig to switch the sprite.
 */
export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private readonly cfg: CharacterConfig;
  private lastDir: Dir = "down";
  /** Reused each frame to avoid per-frame allocation in the movement hot loop. */
  private readonly moveVec = new Phaser.Math.Vector2();

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    cfg: CharacterConfig = SAMURAI_GREEN,
  ) {
    this.cfg = cfg;
    this.sprite = scene.physics.add.sprite(x, y, cfg.key, cfg.walk.down[0] ?? 0);
    this.sprite.setCollideWorldBounds(true);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(12, 12).setOffset(2, 3);

    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input is unavailable");
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys("W,A,S,D") as Record<
      "W" | "A" | "S" | "D",
      Phaser.Input.Keyboard.Key
    >;

    this.ensureAnims(scene);
  }

  private ensureAnims(scene: Phaser.Scene): void {
    const make = (name: string, frames: readonly number[]) => {
      const key = `${this.cfg.key}-${name}`;
      if (scene.anims.exists(key)) return;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(this.cfg.key, { frames: [...frames] }),
        frameRate: this.cfg.frameRate ?? 8,
        repeat: -1,
      });
    };
    make("down", this.cfg.walk.down);
    make("up", this.cfg.walk.up);
    make("side", this.cfg.walk.side);
  }

  update(): void {
    // Y-sort every frame (before any early return) so a stationary player still
    // draws correctly in front of / behind furniture and counters.
    this.sprite.setDepth(this.sprite.y);

    // Frozen until the player has entered their name (welcome prompt is open).
    if (gameStore.getState().playerName === null) {
      this.sprite.setVelocity(0, 0);
      this.applyIdle();
      return;
    }

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;

    const vec = this.moveVec
      .set((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0))
      .normalize()
      .scale(SPEED);
    this.sprite.setVelocity(vec.x, vec.y);

    const anim = (name: string) => `${this.cfg.key}-${name}`;

    if (vec.x === 0 && vec.y === 0) {
      this.sprite.anims.stop();
      this.applyIdle();
      return;
    }

    if (Math.abs(vec.x) > Math.abs(vec.y)) {
      const goRight = vec.x > 0;
      this.lastDir = goRight ? "right" : "left";
      this.sprite.setFlipX(goRight ? !this.cfg.sideFacesRight : this.cfg.sideFacesRight);
      this.sprite.anims.play(anim("side"), true);
    } else {
      this.lastDir = vec.y < 0 ? "up" : "down";
      this.sprite.setFlipX(false);
      this.sprite.anims.play(anim(this.lastDir), true);
    }
  }

  private applyIdle(): void {
    const { walk, sideFacesRight } = this.cfg;
    switch (this.lastDir) {
      case "down":
        this.sprite.setFlipX(false).setFrame(walk.down[0] ?? 0);
        break;
      case "up":
        this.sprite.setFlipX(false).setFrame(walk.up[0] ?? 0);
        break;
      case "left":
        this.sprite.setFlipX(sideFacesRight).setFrame(walk.side[0] ?? 0);
        break;
      case "right":
        this.sprite.setFlipX(!sideFacesRight).setFrame(walk.side[0] ?? 0);
        break;
    }
  }
}
