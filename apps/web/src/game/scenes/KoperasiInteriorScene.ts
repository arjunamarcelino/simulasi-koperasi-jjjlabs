import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { PALETTE } from "../palette";
import { LABEL_STYLE } from "../textStyles";
import { Player } from "../entities/Player";
import { VILLAGER } from "../entities/characters";
import { KOPERASI_ROOMS, type RoomId } from "../../world/rooms.config";
import { gameStore } from "../../stores/game.store";

const MAP_W = 640;
const MAP_H = 368;
const TILE = 16;

// Frames in the interiorTiles spritesheet (352px wide → 22 cols; index = row*22+col).
const FLOOR_FRAME = 290; // warm yellow brick floor
const WALL_FRAME = 298; // dark brown brick wall

const INTERACT_RADIUS = 48;
const EXIT_RADIUS = 40;

// Brief loading trivia (hardcoded) shown when leaving the koperasi back to the village.
const EXIT_TRIVIA =
  "Koperasi Desa Merah Putih punya beragam unit usaha — sembako, simpan pinjam, apotek/klinik desa, hingga gudang & logistik — untuk memperkuat ekonomi desa dan memangkas rantai tengkulak.";

// Furniture from the LimeZu "Modern Interiors" sheet (16 cols; frame = r*16 + c).
// Each entry is a multi-tile object: top-left tile (c,r) + size (w,h) in tiles.
type LzDef = { c: number; r: number; w: number; h: number };
const LZ = {
  kasir: { c: 3, r: 8, w: 1, h: 2 }, // computer + printer workstation (131,147)
  deskExt: { c: 3, r: 5, w: 1, h: 1 }, // desk-top extension (83)
  chair: { c: 5, r: 21, w: 1, h: 2 }, // chair facing down (341,357)
  fridge: { c: 2, r: 18, w: 4, h: 3 }, // refrigerated display / kulkas
  goodsShelf: { c: 6, r: 18, w: 2, h: 3 }, // minimart goods shelf
  gudangRak: { c: 5, r: 14, w: 2, h: 4 }, // stocked storage shelf
  poster: { c: 0, r: 22, w: 2, h: 2 }, // framed wall poster (352,353,368,369)
  rapatDeco: { c: 13, r: 38, w: 2, h: 2 }, // meeting-room wall decoration (621,622,637,638)
  rapatDeco2: { c: 0, r: 41, w: 2, h: 1 }, // meeting-room wall object (656,657)
  computer: { c: 13, r: 40, w: 2, h: 2 }, // monitor + keyboard (quiz)
  plant: { c: 12, r: 45, w: 1, h: 2 }, // pohon (732,748)
} as const satisfies Record<string, LzDef>;

// A long conference table = three "big tables" joined by the connector column.
// Each table = left/right cap (160/163) around a 2-wide middle (161,162); the
// connector (164,180,196) replaces the inner caps so the joins look seamless.
const MEETING_TABLE_COLS: readonly (readonly [number, number, number])[] = [
  [160, 176, 192], // table 1 — left cap
  [161, 177, 193],
  [162, 178, 194],
  [164, 180, 196], // join 1–2
  [161, 177, 193], // table 2
  [162, 178, 194],
  [164, 180, 196], // join 2–3
  [161, 177, 193], // table 3
  [162, 178, 194],
  [163, 179, 195], // right cap
];

/** A pixel rectangle [x, y, w, h] (top-left origin) — used for wall bands. */
type Rect = readonly [number, number, number, number];

// Wall bands (brick), leaving gaps for the top exit and the two room doors.
const WALLS: readonly Rect[] = [
  [0, 0, 212, 32], // top wall, left of entrance gap (212..268)
  [268, 0, 372, 32], // top wall, right of entrance gap
  [0, 0, 16, MAP_H], // left wall
  [MAP_W - 16, 0, 16, MAP_H], // right wall
  [0, MAP_H - 16, MAP_W, 16], // bottom wall
  [16, 208, 132, 16], // divider, left of gudang door (148..196)
  [196, 208, 256, 16], // divider, between gudang & rapat doors
  [500, 208, 124, 16], // divider, right of rapat door (452..500)
  [312, 224, 16, 128], // vertical wall between gudang & ruang rapat
];

type StationKind = RoomId | "exit" | "mading" | "quiz" | "simpan-pinjam";

type Station = {
  id: StationKind;
  label: string;
  x: number;
  y: number;
  radiusSq: number;
  locked: boolean;
  fire: () => void;
};

/**
 * Walkable koperasi interior (mirrors VillageScene): a single static screen with
 * a brick floor + walls, four section "stations" (Marketplace, Kasir, Gudang,
 * Ruang Rapat) and an exit. The player walks up to a station and presses E, which
 * calls `selectRoom(id)`; the React HubOverlays handles confirm / "segera hadir".
 */
export class KoperasiInteriorScene extends Phaser.Scene {
  private player!: Player;
  private eKey!: Phaser.Input.Keyboard.Key;
  private prompt!: Phaser.GameObjects.Container;
  private promptLabel!: Phaser.GameObjects.Text;
  private readonly solids: Phaser.GameObjects.GameObject[] = [];
  private readonly stations: Station[] = [];
  private lastStationId: StationKind | null = null;
  private wasOverlayOpen = false;
  private exiting = false;
  private toast: Phaser.GameObjects.Container | undefined = undefined;

  constructor() {
    super(SceneKey.KoperasiInterior);
  }

  create(): void {
    this.solids.length = 0;
    this.stations.length = 0;
    this.lastStationId = null;
    this.wasOverlayOpen = false;
    this.exiting = false;
    this.toast = undefined;
    // Fresh entry starts from a known overlay state (guards a stale soft-lock).
    gameStore.getState().clearSelection();
    gameStore.getState().setActiveHubScene("KoperasiInterior");
    gameStore.getState().hideSceneLoading(); // interior ready — clear the enter overlay

    this.drawFloor();
    this.drawWalls();
    this.drawDoorways();
    this.buildStations();

    // Spawn just inside the entrance door (right of the kasir booth).
    this.player = new Player(this, 240, 90, VILLAGER);
    this.physics.add.collider(this.player.sprite, this.solids);

    this.cameras.main.setZoom(2);
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.centerOn(MAP_W / 2, MAP_H / 2);
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);

    this.prompt = this.makePrompt();

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input is unavailable");
    this.eKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
  }

  override update(): void {
    // Top-right React door icon requested an exit — leave via the same path as E.
    if (gameStore.getState().koperasiExitRequested) {
      gameStore.getState().consumeKoperasiExit();
      this.exitToVillage();
      return;
    }

    const overlayOpen = gameStore.getState().activeOverlay !== "NONE";

    // Freeze movement + drain E while a React overlay is open above the canvas
    // (the DOM backdrop blocks pointer events but NOT the keyboard).
    if (overlayOpen) {
      this.player.sprite.setVelocity(0, 0);
      this.prompt.setVisible(false);
      Phaser.Input.Keyboard.JustDown(this.eKey); // consume so it can't leak out
      this.wasOverlayOpen = true;
      return;
    }

    this.player.update();

    // Close-edge latch: on the frame the overlay just closed, swallow E so a
    // still-held key can't immediately re-open it (overlay whack-a-mole).
    if (this.wasOverlayOpen) {
      this.wasOverlayOpen = false;
      Phaser.Input.Keyboard.JustDown(this.eKey);
      this.prompt.setVisible(false);
      return;
    }

    const nearest = this.nearestStation();
    if (nearest) {
      if (this.lastStationId !== nearest.id) {
        this.lastStationId = nearest.id;
        this.promptLabel.setText(`Tekan E — ${nearest.label}`);
      }
      // Stations near the top edge (the exit door) show the prompt below so it
      // isn't clipped off the top of the frame.
      const py = nearest.y < 60 ? nearest.y + 34 : nearest.y - 34;
      this.prompt.setPosition(nearest.x, py).setVisible(true);
      if (Phaser.Input.Keyboard.JustDown(this.eKey)) nearest.fire();
    } else {
      this.lastStationId = null;
      this.prompt.setVisible(false);
    }
  }

  /** Nearest in-range station, computed once per frame; ties resolve by index. */
  private nearestStation(): Station | null {
    const { x, y } = this.player.sprite;
    let best: Station | null = null;
    let bestSq = Infinity;
    for (const s of this.stations) {
      const dSq = Phaser.Math.Distance.Squared(x, y, s.x, s.y);
      if (dSq <= s.radiusSq && dSq < bestSq) {
        bestSq = dSq;
        best = s;
      }
    }
    return best;
  }

  // ---- world building -------------------------------------------------------

  private drawFloor(): void {
    for (let y = 0; y < MAP_H; y += TILE) {
      for (let x = 0; x < MAP_W; x += TILE) {
        this.add.image(x, y, "interiorTiles", FLOOR_FRAME).setOrigin(0, 0).setDepth(-100);
      }
    }
  }

  private drawWalls(): void {
    for (const [x, y, w, h] of WALLS) {
      // TileSprite tiles the brick and clips at the band's exact bounds, so a
      // wall never spills a partial tile into a door gap (kept tidy at every door).
      this.add
        .tileSprite(x, y, w, h, "interiorTiles", WALL_FRAME)
        .setOrigin(0, 0)
        .setDepth(y + h);
      this.addSolid(x + w / 2, y + h / 2, w, h);
    }
  }

  /** Wooden posts framing the three openings so the gaps read as doorways. */
  private drawDoorways(): void {
    this.drawDoorPosts(172, 208, 24); // gudang door (gap 148..196)
    this.drawDoorPosts(476, 208, 24); // ruang rapat door (gap 452..500)
    this.drawDoorPosts(240, 8, 28); // koperasi entrance/exit (lowered a touch)
  }

  private drawDoorPosts(cx: number, y: number, half: number): void {
    const g = this.add.graphics().setDepth(y + 40);
    g.fillStyle(PALETTE.brown, 1);
    g.fillRect(cx - half - 4, y, 4, 28);
    g.fillRect(cx + half, y, 4, 28);
    g.fillStyle(PALETTE.brown2, 1);
    g.fillRect(cx - half - 4, y, half * 2 + 8, 5); // lintel
  }

  private buildStations(): void {
    // Kasir booth (left): two stacked service desks — Kasir (top) and Simpan
    // Pinjam / pengajuan (bottom), each a computer + printer with a desk extension.
    this.lzStamp(165, 88, LZ.kasir);
    this.lzStamp(149, 88, LZ.deskExt);
    this.lzStamp(133, 88, LZ.deskExt);
    // Label sits in the open floor in front of the counter (gap below the desk),
    // so the "SEGERA HADIR" badge never covers the desk furniture above it.
    this.stationLabel(150, 100, "KASIR", false);
    this.lzStamp(165, 156, LZ.kasir);
    this.lzStamp(149, 156, LZ.deskExt);
    this.lzStamp(133, 156, LZ.deskExt);
    this.stationLabel(150, 172, "SIMPAN PINJAM", false);

    // Marketplace (right hall): fridges flush to the top wall (between the boards)
    // with a grid of goods shelves below — a minimart.
    for (const fx of [400, 468, 536]) this.lzStamp(fx, 66, LZ.fridge);
    for (const ry of [130, 178]) {
      for (const rx of [392, 424, 456, 488, 520, 552]) this.lzStamp(rx, ry, LZ.goodsShelf);
    }
    this.stationLabel(476, 132, "MARKETPLACE", false);

    // Gudang: stocked storage shelves (player enters from the top door).
    this.lzStamp(70, 323, LZ.gudangRak);
    this.lzStamp(130, 323, LZ.gudangRak);
    this.lzStamp(190, 323, LZ.gudangRak);
    this.lzStamp(250, 323, LZ.gudangRak);
    this.stationLabel(150, 236, "GUDANG", false);

    // Ruang rapat: long table + chairs along the top edge + a tree in the corner.
    this.drawMeetingTable(476, 328);
    for (const cx of [412, 444, 476, 508, 540]) this.lzStamp(cx, 284, LZ.chair, false);
    this.lzStamp(410, 236, LZ.rapatDeco, false); // left of the rapat door
    this.lzStamp(540, 230, LZ.rapatDeco2, false); // right of the rapat door
    this.stationLabel(476, 236, "RUANG RAPAT", true);
    this.lzStamp(606, 346, LZ.plant);

    // Points of interest: wall boards (mading) + a computer for the koperasi quiz.
    this.lzStamp(180, 48, LZ.poster, false);
    this.lzStamp(300, 48, LZ.poster, false);
    this.lzStamp(340, 48, LZ.poster, false);
    this.lzStamp(320, 200, LZ.computer);
    this.stationLabel(320, 150, "KUIS", false);

    const spot: Record<RoomId, { x: number; y: number }> = {
      kasir: { x: 165, y: 112 },
      marketplace: { x: 476, y: 196 },
      gudang: { x: 150, y: 262 },
      "ruang-meeting": { x: 476, y: 270 },
    };

    for (const room of KOPERASI_ROOMS) {
      const at = spot[room.id];
      this.stations.push({
        id: room.id,
        label: room.label,
        x: at.x,
        y: at.y,
        radiusSq: INTERACT_RADIUS * INTERACT_RADIUS,
        locked: room.status !== "AVAILABLE",
        fire: () => gameStore.getState().selectRoom(room.id),
      });
    }

    // Exit back to the village (top doorway) — latched so it fires once.
    this.stations.push({
      id: "exit",
      label: "Keluar",
      x: 240,
      y: 44,
      radiusSq: EXIT_RADIUS * EXIT_RADIUS,
      locked: false,
      fire: () => this.exitToVillage(),
    });

    // Points of interest — mapped now, real content wired later (show a stub toast).
    this.addPoi("mading", "Papan Info", 200, 54);
    this.addPoi("mading", "Papan Info", 340, 54);
    this.addPoi("quiz", "Kuis Koperasi", 320, 150);
    this.addPoi("simpan-pinjam", "Simpan Pinjam", 165, 180);
  }

  private addPoi(id: "mading" | "quiz" | "simpan-pinjam", label: string, x: number, y: number): void {
    this.stations.push({
      id,
      label,
      x,
      y,
      radiusSq: INTERACT_RADIUS * INTERACT_RADIUS,
      locked: true,
      fire: () => this.showToast(x, y < 60 ? y + 44 : y - 44, `${label} — segera hadir`),
    });
  }

  private exitToVillage(): void {
    if (this.exiting) return;
    this.exiting = true;
    gameStore.getState().clearSelection();
    // Tell VillageScene to spawn the player back at the koperasi doorstep.
    this.registry.set("villageEntry", "koperasi");
    // Brief loading + trivia, then transition (VillageScene.create clears it).
    gameStore.getState().showSceneLoading(EXIT_TRIVIA);
    this.time.delayedCall(4500, () => this.scene.start(SceneKey.Village));
  }

  // ---- furniture (LimeZu Modern Interiors stamps) ---------------------------

  /**
   * Stamp a LimeZu furniture object: horizontally centered at `cx` with its
   * bottom edge at `footY`. Depth = footY for correct y-sort against the player.
   */
  private lzStamp(cx: number, footY: number, def: LzDef, solid = true): void {
    const x0 = Math.round(cx - (def.w * TILE) / 2);
    const y0 = Math.round(footY - def.h * TILE);
    for (let dr = 0; dr < def.h; dr++) {
      for (let dc = 0; dc < def.w; dc++) {
        this.add
          .image(x0 + dc * TILE, y0 + dr * TILE, "lzInterior", (def.r + dr) * 16 + def.c + dc)
          .setOrigin(0, 0)
          .setDepth(footY);
      }
    }
    if (solid) this.addSolid(cx, footY - (def.h * TILE) / 2, def.w * TILE, def.h * TILE);
  }

  /** The long meeting table, stamped column-by-column with the connector piece. */
  private drawMeetingTable(cx: number, footY: number): void {
    const cols = MEETING_TABLE_COLS;
    const x0 = Math.round(cx - (cols.length * TILE) / 2);
    const y0 = Math.round(footY - 3 * TILE);
    cols.forEach((col, dc) => {
      col.forEach((frame, dr) => {
        this.add
          .image(x0 + dc * TILE, y0 + dr * TILE, "lzInterior", frame)
          .setOrigin(0, 0)
          .setDepth(footY);
      });
    });
    this.addSolid(cx, footY - (3 * TILE) / 2, cols.length * TILE, 3 * TILE);
  }

  // ---- ui -------------------------------------------------------------------

  private stationLabel(cx: number, cy: number, text: string, available: boolean): void {
    this.add
      .text(cx, cy, text, {
        fontFamily: LABEL_STYLE.fontFamily ?? "monospace",
        fontSize: "11px",
        color: "#2B2016",
        stroke: "#FBF3DE",
        strokeThickness: 3,
      })
      .setResolution(3)
      .setOrigin(0.5)
      .setDepth(9000);

    const badge = available ? "TERSEDIA" : "SEGERA HADIR";
    this.add
      .text(cx, cy + 13, badge, {
        fontFamily: LABEL_STYLE.fontFamily ?? "monospace",
        fontSize: "9px",
        color: available ? "#FBF3DE" : "#2B2016",
        backgroundColor: available ? "#1F5D3A" : "#D9A521",
      })
      .setResolution(3)
      .setOrigin(0.5)
      .setPadding(4, 2, 4, 2)
      .setDepth(9000);
  }

  /** A brief self-dismissing message (used for not-yet-built points of interest). */
  private showToast(x: number, y: number, text: string): void {
    this.toast?.destroy();
    const label = this.add
      .text(0, 0, text, {
        fontFamily: LABEL_STYLE.fontFamily ?? "monospace",
        fontSize: "10px",
        color: "#FBF3DE",
      })
      .setResolution(3)
      .setOrigin(0.5);
    const bg = this.add
      .rectangle(0, 0, label.width + 16, 22, PALETTE.ink, 0.95)
      .setStrokeStyle(2, PALETTE.mustard);
    this.toast = this.add.container(x, y, [bg, label]).setDepth(10001);
    this.time.delayedCall(1500, () => {
      this.toast?.destroy();
      this.toast = undefined;
    });
  }

  private makePrompt(): Phaser.GameObjects.Container {
    this.promptLabel = this.add
      .text(0, 0, "", {
        fontFamily: LABEL_STYLE.fontFamily ?? "monospace",
        fontSize: "10px",
        color: "#FBF3DE",
      })
      .setResolution(3)
      .setOrigin(0.5);
    const bg = this.add
      .rectangle(0, 0, 170, 20, PALETTE.forest2, 0.92)
      .setStrokeStyle(2, PALETTE.mustard);
    return this.add.container(0, 0, [bg, this.promptLabel]).setDepth(9999).setVisible(false);
  }

  private addSolid(cx: number, cy: number, w: number, h: number): void {
    const rect = this.add.rectangle(cx, cy, w, h).setVisible(false);
    this.physics.add.existing(rect, true);
    this.solids.push(rect);
  }
}
