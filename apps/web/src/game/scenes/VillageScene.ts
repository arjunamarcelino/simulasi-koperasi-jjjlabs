import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { makeInteractable } from "../interaction/makeInteractable";
import { Player } from "../entities/Player";

const VILLAGE_COLS = 20; // columns in tileset_village_abandoned spritesheet
const NEAR_DOOR_KEY = "villageNearDoor";

/** A multi-tile "stamp" region from the village tileset. */
type Stamp = { col: number; row: number; w: number; h: number };
const KOPERASI: Stamp = { col: 13, row: 6, w: 3, h: 5 }; // tall wooden lodge w/ door
const BIG_TREE: Stamp = { col: 0, row: 6, w: 4, h: 5 };
const SMALL_TREE: Stamp = { col: 4, row: 6, w: 2, h: 4 };

/**
 * The village hub as a real pixel-art tilemap (Ninja Adventure, CC0) with a
 * walkable player. Ground/water/path + collision come from the Tiled JSON;
 * buildings and trees are stamped from the village tileset with static bodies.
 * The HUD lives in VillageHudScene (unzoomed), fed via the registry.
 */
const DOOR_RADIUS = 40;

export class VillageScene extends Phaser.Scene {
  private player!: Player;
  private eKey!: Phaser.Input.Keyboard.Key;
  private nearDoor = false;
  private readonly doorCenter = new Phaser.Math.Vector2();
  private readonly solids: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super(SceneKey.Village);
  }

  create(): void {
    this.solids.length = 0;

    const map = this.make.tilemap({ key: "village-map" });
    const tiles = map.addTilesetImage("floor", "floorTiles");
    if (!tiles) throw new Error("Village tileset failed to load");

    const ground = map.createLayer("Ground", tiles, 0, 0);
    const collision = map.createLayer("Collision", tiles, 0, 0);
    if (!ground || !collision) throw new Error("Village layers failed to load");
    ground.setDepth(-100);
    collision.setVisible(false).setCollisionByExclusion([-1]);

    this.placeDecor();
    const koperasiDoor = this.placeKoperasi();

    const spawn = map.findObject("Objects", (o) => o.name === "player_spawn");
    this.player = new Player(this, spawn?.x ?? 296, spawn?.y ?? 432);
    this.physics.add.collider(this.player.sprite, collision);
    this.physics.add.collider(this.player.sprite, this.solids);

    this.cameras.main.startFollow(this.player.sprite, true);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setZoom(3);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.setupDoor(map, koperasiDoor);

    this.registry.set(NEAR_DOOR_KEY, false);
    this.scene.launch(SceneKey.VillageHud);
  }

  override update(): void {
    this.player.update();
    const { x, y } = this.player.sprite;
    this.nearDoor =
      Phaser.Math.Distance.Between(x, y, this.doorCenter.x, this.doorCenter.y) <=
      DOOR_RADIUS;
    this.registry.set(NEAR_DOOR_KEY, this.nearDoor);
    if (this.nearDoor && Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.enterKoperasi();
    }
  }

  /** Stamp a multi-tile region as images with base-Y depth (for y-sorting). */
  private stamp(s: Stamp, x: number, y: number): void {
    const baseDepth = y + s.h * 16;
    for (let dr = 0; dr < s.h; dr++) {
      for (let dc = 0; dc < s.w; dc++) {
        const frame = (s.row + dr) * VILLAGE_COLS + (s.col + dc);
        this.add
          .image(x + dc * 16, y + dr * 16, "villageTiles", frame)
          .setOrigin(0, 0)
          .setDepth(baseDepth);
      }
    }
  }

  /** Invisible static rectangle body used for collision. */
  private addSolid(cx: number, cy: number, w: number, h: number): void {
    const rect = this.add.rectangle(cx, cy, w, h).setVisible(false);
    this.physics.add.existing(rect, true); // static body
    this.solids.push(rect);
  }

  private placeKoperasi(): { x: number; y: number } {
    const x = 272; // tile col 17
    const y = 48; // tile row 3
    this.stamp(KOPERASI, x, y);
    // Solid over the whole footprint so the player stops just BELOW the building
    // (rendered in front via y-sort) right on the door zone.
    this.addSolid(
      x + (KOPERASI.w * 16) / 2,
      y + (KOPERASI.h * 16) / 2,
      KOPERASI.w * 16,
      KOPERASI.h * 16,
    );
    return { x: x + 16, y: y + KOPERASI.h * 16 };
  }

  private placeDecor(): void {
    const trees: Array<[Stamp, number, number]> = [
      [BIG_TREE, 48, 112],
      [BIG_TREE, 496, 96],
      [BIG_TREE, 80, 336],
      [SMALL_TREE, 224, 150],
      [SMALL_TREE, 384, 352],
      [SMALL_TREE, 540, 336],
    ];
    for (const [s, x, y] of trees) {
      this.stamp(s, x, y);
      this.addSolid(x + (s.w * 16) / 2, y + s.h * 16 - 10, 20, 12);
    }
  }

  private setupDoor(map: Phaser.Tilemaps.Tilemap, fallback: { x: number; y: number }): void {
    const door = map.findObject("Objects", (o) => o.name === "door");
    const dx = door?.x ?? fallback.x;
    const dy = door?.y ?? fallback.y;
    const dw = door?.width ?? 16;
    const dh = door?.height ?? 24;

    this.doorCenter.set(dx + dw / 2, dy + dh / 2);
    // Interactive zone for the click fallback (no physics body needed).
    const zone = this.add.zone(this.doorCenter.x, this.doorCenter.y, dw, dh);
    makeInteractable(zone, () => this.enterKoperasi());

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input is unavailable");
    this.eKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
  }

  private enterKoperasi(): void {
    this.registry.set(NEAR_DOOR_KEY, false);
    this.scene.stop(SceneKey.VillageHud);
    this.scene.start(SceneKey.KoperasiInterior);
  }
}
