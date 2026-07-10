import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { makeInteractable } from "../interaction/makeInteractable";
import { Player } from "../entities/Player";

const VILLAGE_COLS = 20; // columns in tileset_village_abandoned spritesheet
const NEAR_DOOR_KEY = "villageNearDoor";
const DOOR_RADIUS = 40;
const MAP_W = 640;
const MAP_H = 352;

/** A multi-tile "stamp" region from the village tileset. */
type Stamp = { col: number; row: number; w: number; h: number };
const KOPERASI: Stamp = { col: 11, row: 6, w: 5, h: 5 }; // tall wooden lodge (full bounds incl. moss)
const MOSSY_HOUSE: Stamp = { col: 11, row: 0, w: 3, h: 3 }; // mossy green-roof house
const WOOD_HOUSE: Stamp = { col: 16, row: 8, w: 4, h: 2 }; // wooden A-frame house (clean bounds)
const BIG_TREE: Stamp = { col: 1, row: 6, w: 3, h: 3 };
const SMALL_TREE: Stamp = { col: 4, row: 6, w: 2, h: 2 };
const STUMP: Stamp = { col: 7, row: 8, w: 2, h: 3 }; // orange cut log

/** Single-tile ground decorations (bushes / shrubs / tufts / dead grass). */
const SCATTER_FRAMES = [104, 105, 164, 165, 224, 225, 88, 89, 90] as const;
/** Hand-placed scatter spots ringing the central clearing (kept off the play path). */
const SCATTER_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [48, 120], [64, 180], [40, 240], [70, 300], [176, 300], [210, 300], [150, 180],
  [200, 130], [232, 210], [250, 300], [176, 130], [240, 150], [40, 90],
  [560, 120], [540, 190], [560, 290], [420, 300], [470, 300], [400, 150], [530, 150],
  [590, 220], [440, 240], [380, 300], [560, 60],
];

/**
 * The village hub as a real pixel-art tilemap (Ninja Adventure, CC0) — a single
 * fixed screen (no scrolling) densely framed with trees and scattered decor, with
 * a walkable player. HUD lives in VillageHudScene (unzoomed), fed via the registry.
 */
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

    this.placeKoperasi();
    this.placeBuildings();
    this.placeTreeBorder();
    this.placeScatter();
    this.placeAccents();

    const spawn = map.findObject("Objects", (o) => o.name === "player_spawn");
    this.player = new Player(this, spawn?.x ?? 320, spawn?.y ?? 248);
    this.physics.add.collider(this.player.sprite, collision);
    this.physics.add.collider(this.player.sprite, this.solids);

    // Single fixed screen: static camera showing the whole map (no scrolling).
    this.cameras.main.setZoom(2);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.centerOn(map.widthInPixels / 2, map.heightInPixels / 2);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.setupDoor(map);

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

  private addSolid(cx: number, cy: number, w: number, h: number): void {
    const rect = this.add.rectangle(cx, cy, w, h).setVisible(false);
    this.physics.add.existing(rect, true);
    this.solids.push(rect);
  }

  private placeTree(s: Stamp, x: number, y: number, collide: boolean): void {
    this.stamp(s, x, y);
    if (collide) this.addSolid(x + (s.w * 16) / 2, y + s.h * 16 - 8, s.w * 16 - 8, 10);
  }

  private placeKoperasi(): void {
    const x = 272; // door tile (stamp col+2) lands at world x ~312
    const y = 16;
    this.stamp(KOPERASI, x, y);
    // Collide only the solid body (skip the outer moss fringe columns).
    this.addSolid(x + KOPERASI.w * 8, y + (KOPERASI.h * 16) / 2, (KOPERASI.w - 1) * 16, KOPERASI.h * 16);
  }

  /** Decorative neighbour buildings (not enterable) with collision. */
  private placeBuildings(): void {
    for (const [s, x, y] of [
      [MOSSY_HOUSE, 96, 64],
      [WOOD_HOUSE, 448, 64],
    ] as const) {
      this.stamp(s, x, y);
      this.addSolid(x + (s.w * 16) / 2, y + (s.h * 16) / 2, s.w * 16, s.h * 16 - 8);
    }
  }

  /** Dense tree frame around the screen edges (decorative — player is world-bounded). */
  private placeTreeBorder(): void {
    for (let x = -16; x < MAP_W; x += 40) {
      if (x > 244 && x < 360) continue; // gap for the koperasi
      this.placeTree(BIG_TREE, x, -14, false);
    }
    for (let y = 36; y < MAP_H - 48; y += 50) {
      this.placeTree(BIG_TREE, -18, y, false);
      this.placeTree(BIG_TREE, MAP_W - 30, y, false);
    }
    for (let x = 4, i = 0; x < MAP_W - 24; x += 56, i++) {
      this.placeTree(i % 2 === 0 ? SMALL_TREE : BIG_TREE, x, MAP_H - 42, false);
    }
  }

  private placeScatter(): void {
    SCATTER_SPOTS.forEach(([x, y], i) => {
      const frame = SCATTER_FRAMES[i % SCATTER_FRAMES.length];
      this.add.image(x, y, "villageTiles", frame).setOrigin(0, 0).setDepth(y + 16);
    });
  }

  private placeAccents(): void {
    for (const [x, y] of [
      [176, 186],
      [432, 258],
    ] as const) {
      this.stamp(STUMP, x, y);
      this.addSolid(x + (STUMP.w * 16) / 2, y + STUMP.h * 16 - 8, STUMP.w * 16 - 6, 10);
    }
  }

  private setupDoor(map: Phaser.Tilemaps.Tilemap): void {
    const door = map.findObject("Objects", (o) => o.name === "door");
    const dx = door?.x ?? 296;
    const dy = door?.y ?? 92;
    const dw = door?.width ?? 32;
    const dh = door?.height ?? 40;

    this.doorCenter.set(dx + dw / 2, dy + dh / 2);
    const zone = this.add.zone(this.doorCenter.x, this.doorCenter.y, dw, dh);
    makeInteractable(zone, () => this.enterKoperasi()); // click fallback

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
