import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { PALETTE } from "../palette";
import { LABEL_STYLE, TITLE_STYLE } from "../textStyles";
import { makeInteractable } from "../interaction/makeInteractable";
import { GAME_WIDTH, GAME_HEIGHT } from "../dimensions";

type BuildingOpts = { wall: number; roof: number };

/** Outdoor establishing scene. Only the koperasi building is interactive. */
export class VillageScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Village);
  }

  create(): void {
    this.drawBackground();

    // Decorative, non-interactive buildings.
    this.makeBuilding(210, 470, 150, 130, { wall: PALETTE.cream2, roof: PALETTE.brown });
    this.makeBuilding(380, 460, 120, 100, { wall: 0xc9a66b, roof: PALETTE.brown });
    this.makeBuilding(980, 470, 160, 120, { wall: PALETTE.parchment, roof: PALETTE.orange });
    this.makeBuilding(1120, 460, 130, 110, { wall: PALETTE.cream2, roof: PALETTE.brown });

    this.createKoperasi();
    this.addHud();
  }

  private drawBackground(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, PALETTE.sky).setOrigin(0).setDepth(0);
    this.add.rectangle(0, 300, GAME_WIDTH, 130, 0x2e7d50).setOrigin(0).setDepth(1);
    this.add.rectangle(0, 420, GAME_WIDTH, 300, PALETTE.cream2).setOrigin(0).setDepth(2);
    this.add.rectangle(0, 420, GAME_WIDTH, 6, PALETTE.brown).setOrigin(0).setDepth(2);

    // Light path trapezoid guiding the eye to the koperasi door.
    const path = this.add.graphics().setDepth(2);
    path.fillStyle(PALETTE.cream, 1);
    path.fillPoints(
      [
        new Phaser.Geom.Point(560, GAME_HEIGHT),
        new Phaser.Geom.Point(720, GAME_HEIGHT),
        new Phaser.Geom.Point(672, 470),
        new Phaser.Geom.Point(608, 470),
      ],
      true,
    );
  }

  private makeBuilding(
    cx: number,
    baseY: number,
    w: number,
    h: number,
    opts: BuildingOpts,
  ): void {
    const left = cx - w / 2;
    const top = baseY - h;
    const g = this.add.graphics().setDepth(3);

    // Offset drop shadow.
    g.fillStyle(PALETTE.brown2, 1);
    g.fillRect(left + 6, top + 6, w, h);
    // Body.
    g.fillStyle(opts.wall, 1);
    g.fillRect(left, top, w, h);
    g.lineStyle(3, PALETTE.ink, 1);
    g.strokeRect(left, top, w, h);
    // Roof.
    g.fillStyle(opts.roof, 1);
    g.fillTriangle(left - 14, top, left + w + 14, top, cx, top - 46);
    g.lineStyle(3, PALETTE.ink, 1);
    g.strokeTriangle(left - 14, top, left + w + 14, top, cx, top - 46);
    // Door.
    const dw = w * 0.22;
    const dh = h * 0.42;
    g.fillStyle(PALETTE.brown2, 1);
    g.fillRect(cx - dw / 2, baseY - dh, dw, dh);
    g.lineStyle(2, PALETTE.ink, 1);
    g.strokeRect(cx - dw / 2, baseY - dh, dw, dh);
    // Windows.
    const ww = w * 0.18;
    for (const wx of [cx - w * 0.28, cx + w * 0.28]) {
      g.fillStyle(PALETTE.parchment, 1);
      g.fillRect(wx - ww / 2, top + h * 0.22, ww, ww);
      g.lineStyle(2, PALETTE.ink, 1);
      g.strokeRect(wx - ww / 2, top + h * 0.22, ww, ww);
    }
  }

  private createKoperasi(): void {
    const cx = 660;
    const baseY = 560;
    const w = 300;
    const h = 240;

    this.makeBuilding(cx, baseY, w, h, { wall: PALETTE.forest, roof: PALETTE.forest2 });

    // Signboard.
    const sign = this.add.graphics().setDepth(5);
    sign.fillStyle(PALETTE.mustard, 1);
    sign.fillRect(cx - 110, baseY - h - 6, 220, 46);
    sign.lineStyle(3, PALETTE.ink, 1);
    sign.strokeRect(cx - 110, baseY - h - 6, 220, 46);
    this.add
      .text(cx, baseY - h + 17, "KOPERASI", {
        fontFamily: '"Press Start 2P",monospace',
        fontSize: "16px",
        color: "#2B2016",
      })
      .setOrigin(0.5)
      .setDepth(5);

    // Hover affordance (hidden until pointerover).
    const ring = this.add
      .rectangle(cx, baseY - h / 2, w + 24, h + 24)
      .setStrokeStyle(4, PALETTE.mustard)
      .setDepth(6)
      .setVisible(false);
    const enter = this.add
      .text(cx, baseY - h - 42, "Masuk →", {
        ...LABEL_STYLE,
        fontSize: "26px",
        color: "#FBF3DE",
        backgroundColor: "#1F5D3A",
      })
      .setOrigin(0.5)
      .setPadding(10, 6, 10, 6)
      .setDepth(6)
      .setVisible(false);

    const zone = this.add.zone(cx, baseY - h / 2, w, h).setDepth(6);
    zone.on(Phaser.Input.Events.POINTER_OVER, () => {
      ring.setVisible(true);
      enter.setVisible(true);
    });
    zone.on(Phaser.Input.Events.POINTER_OUT, () => {
      ring.setVisible(false);
      enter.setVisible(false);
    });
    makeInteractable(zone, () => this.scene.start(SceneKey.KoperasiInterior));
  }

  private addHud(): void {
    this.add.rectangle(40, 34, 320, 58, PALETTE.forest).setOrigin(0).setStrokeStyle(3, PALETTE.ink).setDepth(10);
    this.add.text(58, 63, "Desa Koperasi", { ...TITLE_STYLE, fontSize: "20px" }).setOrigin(0, 0.5).setDepth(10);

    this.add.rectangle(GAME_WIDTH / 2, 682, 560, 44, PALETTE.parchment).setStrokeStyle(3, PALETTE.ink).setDepth(10);
    this.add
      .text(GAME_WIDTH / 2, 682, "Klik gedung koperasi untuk masuk", { ...LABEL_STYLE, fontSize: "24px" })
      .setOrigin(0.5)
      .setDepth(10);
  }
}
