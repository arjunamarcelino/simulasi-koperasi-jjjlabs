import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { PALETTE } from "../palette";
import { LABEL_STYLE } from "../textStyles";
import { GAME_WIDTH, GAME_HEIGHT } from "../dimensions";

const ASSET_BASE = "/assets/ninja";

/** Loads tilemap, tilesets, and character spritesheet with a progress bar. */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Preload);
  }

  preload(): void {
    this.drawLoadingBar();
    this.load.image("floorTiles", `${ASSET_BASE}/tileset_floor.png`);
    this.load.spritesheet("villageTiles", `${ASSET_BASE}/tileset_village_abandoned.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("interiorTiles", `${ASSET_BASE}/tileset_interior_floor.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    // LimeZu Modern Interiors (free, non-commercial) — furniture for the koperasi.
    this.load.spritesheet("lzInterior", "/assets/limezu/interiors_16x16.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("samurai", `${ASSET_BASE}/samurai_green.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("villager", `${ASSET_BASE}/villager.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.tilemapTiledJSON("village-map", `${ASSET_BASE}/village.json`);
  }

  create(): void {
    this.scene.start(SceneKey.Village);
  }

  private drawLoadingBar(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    this.add.text(cx, cy - 44, "Memuat...", { ...LABEL_STYLE, fontSize: "28px" }).setOrigin(0.5);

    const w = 360;
    const h = 26;
    this.add.rectangle(cx, cy, w, h, PALETTE.forest2).setStrokeStyle(3, PALETTE.ink);
    const bar = this.add
      .rectangle(cx - w / 2 + 3, cy, 0, h - 8, PALETTE.mustard)
      .setOrigin(0, 0.5);
    this.load.on("progress", (p: number) => {
      bar.width = (w - 6) * p;
    });
  }
}
