import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { makeInteractable } from "../interaction/makeInteractable";
import { Player } from "../entities/Player";
import { VILLAGER } from "../entities/characters";
import { PALETTE } from "../palette";
import { LABEL_STYLE } from "../textStyles";
import { gameStore } from "../../stores/game.store";

const VILLAGE_COLS = 20; // columns in tileset_village_abandoned spritesheet
const DOOR_RADIUS = 44;
const MAP_W = 640;
const MAP_H = 368;

/** A multi-tile "stamp" region from the village tileset. */
type Stamp = { col: number; row: number; w: number; h: number };
const KOPERASI: Stamp = { col: 11, row: 6, w: 5, h: 5 }; // tall lodge (full bounds)
const MOSSY_A: Stamp = { col: 11, row: 0, w: 3, h: 3 }; // green-roof mossy house
const MOSSY_B: Stamp = { col: 11, row: 3, w: 3, h: 3 }; // beige mossy house
const BIG_TREE: Stamp = { col: 0, row: 6, w: 4, h: 3 }; // full canopy (bulges to cols 0 & 4)
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
  private greetBubble: Phaser.GameObjects.Container | undefined = undefined;
  private doorPrompt: Phaser.GameObjects.Container | undefined = undefined;
  private readonly doorCenter = new Phaser.Math.Vector2();
  private readonly solids: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super(SceneKey.Village);
  }

  create(): void {
    this.solids.length = 0;
    gameStore.getState().setActiveHubScene("Village");

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

    // Returning from the koperasi drops the player at the doorstep; a fresh play
    // uses the map's player_spawn (where the greeting shows). Flag set on exit.
    const fromKoperasi = this.registry.get("villageEntry") === "koperasi";
    if (fromKoperasi) this.registry.remove("villageEntry");
    const spawn = map.findObject("Objects", (o) => o.name === "player_spawn");
    const door = map.findObject("Objects", (o) => o.name === "door");
    const spawnX = fromKoperasi
      ? (door?.x ?? 304) + (door?.width ?? 32) / 2
      : (spawn?.x ?? 328);
    const spawnY = fromKoperasi
      ? (door?.y ?? 108) + (door?.height ?? 44) + 6
      : (spawn?.y ?? 336);
    this.player = new Player(this, spawnX, spawnY, VILLAGER);
    this.physics.add.collider(this.player.sprite, collision);
    this.physics.add.collider(this.player.sprite, this.solids);

    // Single screen: static camera showing the whole map, scaled to fill window.
    this.cameras.main.setZoom(2);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.centerOn(map.widthInPixels / 2, map.heightInPixels / 2);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.setupDoor(map);
    this.doorPrompt = this.makeDoorPrompt();
    // Below the door (on the path) so it doesn't cover the building.
    this.doorPrompt.setPosition(this.doorCenter.x, this.doorCenter.y + 26).setVisible(false);
    this.setupGreeting();
  }

  /** A UI sign (not a dialog): fixed near the koperasi door, no tail. */
  private makeDoorPrompt(): Phaser.GameObjects.Container {
    const label = this.add
      .text(0, 0, "Tekan E untuk masuk", {
        fontFamily: LABEL_STYLE.fontFamily ?? "monospace",
        fontSize: "9px",
        color: "#FBF3DE",
      })
      .setResolution(3)
      .setOrigin(0.5);
    const w = Math.ceil(label.width) + 12;
    const h = Math.ceil(label.height) + 6;
    const bg = this.add
      .rectangle(0, 0, w, h, PALETTE.forest2, 0.92)
      .setStrokeStyle(2, PALETTE.mustard);
    return this.add.container(0, 0, [bg, label]).setDepth(9999);
  }

  /** Build a crisp pixel speech bubble (parchment + ink) with a downward tail. */
  private makeBubble(text: string): Phaser.GameObjects.Container {
    const label = this.add
      .text(0, 0, text, {
        fontFamily: LABEL_STYLE.fontFamily ?? "monospace",
        fontSize: "10px",
        color: "#2B2016",
      })
      .setResolution(3) // crisp under the 2x camera zoom
      .setOrigin(0.5, 0.5);

    const padX = 6;
    const padY = 3;
    const tail = 5;
    const w = Math.ceil(label.width) + padX * 2;
    const h = Math.ceil(label.height) + padY * 2;
    const top = -(tail + h);
    const bottom = -tail;
    const half = w / 2;
    const pts = [
      new Phaser.Geom.Point(-half, top),
      new Phaser.Geom.Point(half, top),
      new Phaser.Geom.Point(half, bottom),
      new Phaser.Geom.Point(4, bottom),
      new Phaser.Geom.Point(0, 0),
      new Phaser.Geom.Point(-4, bottom),
      new Phaser.Geom.Point(-half, bottom),
    ];
    const g = this.add.graphics();
    g.fillStyle(PALETTE.parchment, 1);
    g.fillPoints(pts, true);
    g.lineStyle(2, PALETTE.ink, 1);
    g.strokePoints(pts, true);
    label.setPosition(0, top + h / 2);

    return this.add.container(0, 0, [g, label]).setDepth(10000);
  }

  /** Show a one-time "Hi, <name>! ..." bubble over the player on first entry. */
  private setupGreeting(): void {
    this.greetBubble = undefined;
    if (this.registry.get("greeted") === true) return;

    const name = gameStore.getState().playerName;
    if (name) {
      this.showGreeting(name);
      return;
    }
    // First play: name not set yet — greet once the welcome prompt is submitted.
    const unsub = gameStore.subscribe(
      (s) => s.playerName,
      (value) => {
        if (value && this.registry.get("greeted") !== true) this.showGreeting(value);
      },
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsub);
    this.events.once(Phaser.Scenes.Events.DESTROY, unsub);
  }

  private showGreeting(name: string): void {
    this.registry.set("greeted", true);
    this.greetBubble = this.makeBubble(`Hi, ${name} di sini!`);
    this.greetBubble.setPosition(this.player.sprite.x, this.player.sprite.y - 10);
  }

  override update(): void {
    this.player.update();
    const { x, y } = this.player.sprite;

    if (this.greetBubble) {
      this.greetBubble.setPosition(x, y - 10);
      const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
      if (body.velocity.x !== 0 || body.velocity.y !== 0) {
        this.greetBubble.destroy();
        this.greetBubble = undefined;
      }
    }

    this.nearDoor =
      Phaser.Math.Distance.Between(x, y, this.doorCenter.x, this.doorCenter.y) <=
      DOOR_RADIUS;

    // Door sign is fixed near the house; only shown when the player is close.
    this.doorPrompt?.setVisible(this.nearDoor);

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
      [120, 266],
      [380, 266],
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
      this.placeTree(BIG_TREE, x, -6); // full top wall (lowered a little), koperasi in front
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
    this.scene.start(SceneKey.KoperasiInterior);
  }
}
