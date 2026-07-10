import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { makeInteractable } from "../interaction/makeInteractable";
import { Player } from "../entities/Player";

const VILLAGE_COLS = 20; // columns in tileset_village_abandoned spritesheet
const NEAR_DOOR_KEY = "villageNearDoor";
const DOOR_RADIUS = 44;
const MAP_W = 640;
const MAP_H = 368;

/** A multi-tile "stamp" region from the village tileset. */
type Stamp = { col: number; row: number; w: number; h: number };
const KOPERASI: Stamp = { col: 11, row: 6, w: 5, h: 5 }; // tall lodge (full bounds)
const MOSSY_A: Stamp = { col: 11, row: 0, w: 3, h: 3 }; // green-roof mossy house
const MOSSY_B: Stamp = { col: 11, row: 3, w: 3, h: 3 }; // beige mossy house
const BIG_TREE: Stamp = { col: 0, row: 6, w: 5, h: 3 }; // full canopy (bulges to cols 0 & 4)
const BIG_TREE_SKIP: ReadonlySet<number> = new Set([124, 164]); // stray neighbour tiles
const SMALL_TREE: Stamp = { col: 4, row: 6, w: 2, h: 2 };

const SCATTER_FRAMES = [104, 105, 164, 165, 224, 225, 88, 89, 90] as const;
const SCATTER_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [48, 140], [130, 150], [180, 110], [210, 190], [150, 220], [60, 200], [100, 110],
  [400, 130], [430, 195], [376, 185], [520, 145], [560, 195], [540, 110], [470, 215],
  [240, 120], [268, 205], [372, 110],
  [72, 320], [160, 322], [250, 320], [400, 320], [500, 320], [560, 320], [112, 352],
];

/**
 * The village hub as a real pixel-art tilemap (Ninja Adventure, CC0): a single
 * screen densely framed with trees, three buildings, a river + bridge path, and
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
    this.placeMiddleTrees();
    this.placeScatter();

    const spawn = map.findObject("Objects", (o) => o.name === "player_spawn");
    this.player = new Player(this, spawn?.x ?? 328, spawn?.y ?? 336);
    this.physics.add.collider(this.player.sprite, collision);
    this.physics.add.collider(this.player.sprite, this.solids);

    // Single screen: static camera showing the whole map, scaled to fill window.
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

  private stamp(s: Stamp, x: number, y: number, skip?: ReadonlySet<number>): void {
    const baseDepth = y + s.h * 16;
    for (let dr = 0; dr < s.h; dr++) {
      for (let dc = 0; dc < s.w; dc++) {
        const frame = (s.row + dr) * VILLAGE_COLS + (s.col + dc);
        if (skip?.has(frame)) continue;
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

  private placeTree(s: Stamp, x: number, y: number): void {
    this.stamp(s, x, y, s === BIG_TREE ? BIG_TREE_SKIP : undefined);
  }

  private placeKoperasi(): void {
    const x = 280;
    const y = 44; // lowered
    this.stamp(KOPERASI, x, y);
    this.addSolid(x + KOPERASI.w * 8, y + (KOPERASI.h * 16) / 2, (KOPERASI.w - 1) * 16, KOPERASI.h * 16);
  }

  /** Standalone trees dotted through the open middle (not just the border). */
  private placeMiddleTrees(): void {
    for (const [x, y] of [
      [110, 150],
      [372, 150],
      [120, 296],
      [380, 296],
    ] as const) {
      this.placeTree(BIG_TREE, x, y);
      this.addSolid(x + BIG_TREE.w * 8, y + BIG_TREE.h * 16 - 8, 26, 10); // trunk collider
    }
  }

  private placeBuildings(): void {
    for (const [s, x, y] of [
      [MOSSY_A, 80, 80],
      [MOSSY_B, 464, 80],
    ] as const) {
      this.stamp(s, x, y);
      this.addSolid(x + (s.w * 16) / 2, y + (s.h * 16) / 2, s.w * 16, s.h * 16 - 8);
    }
  }

  /** Dense tree frame around the screen. Top row is continuous (no gaps). */
  private placeTreeBorder(): void {
    for (let x = -48; x < MAP_W + 8; x += 34) {
      this.placeTree(BIG_TREE, x, -18); // full top wall, koperasi sits lower/in front
    }
    for (let y = 30; y < MAP_H - 50; y += 46) {
      this.placeTree(BIG_TREE, -24, y);
      this.placeTree(BIG_TREE, MAP_W - 56, y);
    }
    for (let x = -16, i = 0; x < MAP_W + 8; x += 40, i++) {
      this.placeTree(i % 3 === 2 ? SMALL_TREE : BIG_TREE, x, MAP_H - 44);
    }
  }

  private placeScatter(): void {
    SCATTER_SPOTS.forEach(([x, y], i) => {
      const frame = SCATTER_FRAMES[i % SCATTER_FRAMES.length];
      this.add.image(x, y, "villageTiles", frame).setOrigin(0, 0).setDepth(y + 16);
    });
  }

  private setupDoor(map: Phaser.Tilemaps.Tilemap): void {
    const door = map.findObject("Objects", (o) => o.name === "door");
    const dx = door?.x ?? 304;
    const dy = door?.y ?? 72;
    const dw = door?.width ?? 32;
    const dh = door?.height ?? 44;

    this.doorCenter.set(dx + dw / 2, dy + dh / 2);
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
