import Phaser from "phaser";

const SPEED = 90;
type Dir = "down" | "up" | "left" | "right";

/** Idle frame per direction (first frame of each walk row). */
const IDLE_FRAME: Record<Dir, number> = { down: 0, up: 4, left: 8, right: 12 };

/**
 * Player character: an arcade-physics sprite with WASD/arrow movement and
 * 4-direction walk animations. Movement logic lives here so it slots into any
 * scene; the sprite is exposed for colliders/camera.
 */
export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private lastDir: Dir = "down";

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.physics.add.sprite(x, y, "samurai", IDLE_FRAME.down);
    this.sprite.setCollideWorldBounds(true);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(12, 12).setOffset(2, 3); // tighter body than the 16px frame

    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input is unavailable");
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys("W,A,S,D") as Record<
      "W" | "A" | "S" | "D",
      Phaser.Input.Keyboard.Key
    >;

    Player.ensureAnims(scene);
  }

  /** Animations are global on the AnimationManager — guard against re-create on scene restart. */
  private static ensureAnims(scene: Phaser.Scene): void {
    const make = (key: string, start: number, end: number) => {
      if (scene.anims.exists(key)) return;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers("samurai", { start, end }),
        frameRate: 8,
        repeat: -1,
      });
    };
    // samurai_green: 4 cols x 7 rows. Rows 0-3 = walk down/up/left/right.
    make("walk-down", 0, 3);
    make("walk-up", 4, 7);
    make("walk-left", 8, 11);
    make("walk-right", 12, 15);
  }

  update(): void {
    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;

    const vec = new Phaser.Math.Vector2(
      (right ? 1 : 0) - (left ? 1 : 0),
      (down ? 1 : 0) - (up ? 1 : 0),
    );
    vec.normalize().scale(SPEED); // normalize prevents faster diagonals
    this.sprite.setVelocity(vec.x, vec.y);
    this.sprite.setDepth(this.sprite.y); // y-sort against decor

    if (vec.x === 0 && vec.y === 0) {
      this.sprite.anims.stop();
      this.sprite.setFrame(IDLE_FRAME[this.lastDir]);
      return;
    }
    this.lastDir =
      Math.abs(vec.x) > Math.abs(vec.y)
        ? vec.x < 0
          ? "left"
          : "right"
        : vec.y < 0
          ? "up"
          : "down";
    this.sprite.anims.play(`walk-${this.lastDir}`, true);
  }
}
