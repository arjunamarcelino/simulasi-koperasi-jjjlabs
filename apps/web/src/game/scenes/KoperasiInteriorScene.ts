import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { PALETTE } from "../palette";
import { LABEL_STYLE, TITLE_STYLE } from "../textStyles";
import { makeInteractable } from "../interaction/makeInteractable";
import { GAME_WIDTH } from "../dimensions";
import { KOPERASI_ROOMS, type Room } from "../../world/rooms.config";
import { gameStore } from "../../stores/game.store";

/** Interior of the koperasi building. Rooms are clickable zones from config. */
export class KoperasiInteriorScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.KoperasiInterior);
  }

  create(): void {
    this.drawRoomShell();
    for (const room of KOPERASI_ROOMS) {
      this.makeRoomCard(room);
    }
    this.makeExit();
    this.addHud();
  }

  private drawRoomShell(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, 720, PALETTE.cream2).setOrigin(0).setDepth(0);

    const wainscot = this.add.graphics().setDepth(1);
    wainscot.lineStyle(2, 0xd9c39a, 1);
    for (let x = 0; x <= GAME_WIDTH; x += 80) {
      wainscot.lineBetween(x, 150, x, 540);
    }
    this.add.rectangle(0, 150, GAME_WIDTH, 4, PALETTE.brown).setOrigin(0).setDepth(1);

    this.add.rectangle(0, 560, GAME_WIDTH, 160, PALETTE.brown).setOrigin(0).setDepth(2);
    this.add.rectangle(0, 540, GAME_WIDTH, 20, PALETTE.brown2).setOrigin(0).setDepth(2);
    const floor = this.add.graphics().setDepth(2);
    floor.lineStyle(2, PALETTE.brown2, 1);
    for (let x = 0; x <= GAME_WIDTH; x += 90) {
      floor.lineBetween(x, 560, x, 720);
    }
  }

  private makeRoomCard(room: Room): void {
    const { x, y, width: w, height: h } = room.position;
    const available = room.status === "AVAILABLE";

    const g = this.add.graphics().setDepth(3);
    g.fillStyle(PALETTE.brown2, 1);
    g.fillRect(x + 6, y + 6, w, h);
    g.fillStyle(PALETTE.brown, 1);
    g.fillRect(x, y, w, h);
    g.lineStyle(3, PALETTE.ink, 1);
    g.strokeRect(x, y, w, h);
    g.fillStyle(available ? PALETTE.parchment : 0xb9a985, 1);
    g.fillRect(x + 14, y + 14, w - 28, h - 28);
    g.lineStyle(2, PALETTE.ink, 1);
    g.strokeRect(x + 14, y + 14, w - 28, h - 28);

    this.drawRoomIcon(room.id, x + w / 2, y + 100);
    this.add
      .text(x + w / 2, y + h - 62, room.label, { ...LABEL_STYLE, fontSize: "26px" })
      .setOrigin(0.5)
      .setDepth(3);
    this.drawStatusTag(available, x, y, w);

    if (available) {
      this.add.rectangle(x + w / 2, 560, w * 0.8, 10, PALETTE.mustard, 0.5).setDepth(2);
    } else {
      this.add.rectangle(x, y, w, h, PALETTE.ink, 0.28).setOrigin(0).setDepth(3);
      this.drawLock(x + w / 2, y + h / 2 - 10);
    }

    const ring = this.add
      .rectangle(x + w / 2, y + h / 2, w + 12, h + 12)
      .setStrokeStyle(4, PALETTE.mustard)
      .setDepth(4)
      .setVisible(false);
    const zone = this.add.zone(x + w / 2, y + h / 2, w, h).setDepth(4);
    zone.on(Phaser.Input.Events.POINTER_OVER, () => ring.setVisible(true));
    zone.on(Phaser.Input.Events.POINTER_OUT, () => ring.setVisible(false));
    makeInteractable(zone, () => gameStore.getState().selectRoom(room.id));
  }

  private drawRoomIcon(id: string, cx: number, cy: number): void {
    const g = this.add.graphics().setDepth(3);
    if (id === "ruang-meeting") {
      g.fillStyle(PALETTE.forest, 1);
      g.fillRect(cx - 30, cy - 6, 60, 16);
      g.fillStyle(PALETTE.brown2, 1);
      g.fillRect(cx - 26, cy + 10, 6, 16);
      g.fillRect(cx + 20, cy + 10, 6, 16);
      g.fillStyle(PALETTE.mustard, 1);
      for (const dx of [-24, 0, 24]) {
        g.fillRect(cx + dx - 5, cy - 24, 10, 10);
      }
    } else if (id === "gudang") {
      g.fillStyle(PALETTE.brown, 1);
      g.fillRect(cx - 26, cy - 20, 52, 44);
      g.fillStyle(PALETTE.brown2, 1);
      g.fillRect(cx - 26, cy - 24, 52, 8);
      g.lineStyle(3, PALETTE.ink, 1);
      g.lineBetween(cx - 26, cy - 20, cx + 26, cy + 24);
      g.lineBetween(cx + 26, cy - 20, cx - 26, cy + 24);
    } else {
      g.fillStyle(PALETTE.orange, 1);
      g.fillRect(cx - 24, cy - 16, 48, 26);
      g.lineStyle(3, PALETTE.ink, 1);
      g.strokeRect(cx - 24, cy - 16, 48, 26);
      g.fillStyle(PALETTE.ink, 1);
      g.fillCircle(cx - 14, cy + 18, 6);
      g.fillCircle(cx + 14, cy + 18, 6);
    }
  }

  private drawStatusTag(available: boolean, x: number, y: number, w: number): void {
    const tagW = available ? 96 : 132;
    const tx = x + w - 12 - tagW;
    const ty = y + 12;
    const g = this.add.graphics().setDepth(3);
    g.fillStyle(available ? PALETTE.forest : 0x8c7a5c, 1);
    g.fillRect(tx, ty, tagW, 30);
    g.lineStyle(2, PALETTE.ink, 1);
    g.strokeRect(tx, ty, tagW, 30);
    this.add
      .text(tx + tagW / 2, ty + 15, available ? "TERSEDIA" : "SEGERA HADIR", {
        ...LABEL_STYLE,
        fontSize: available ? "18px" : "16px",
        color: available ? "#FBF3DE" : "#2B2016",
        strokeThickness: 0,
      })
      .setOrigin(0.5)
      .setDepth(3);
  }

  private drawLock(cx: number, cy: number): void {
    const g = this.add.graphics().setDepth(3);
    g.lineStyle(5, PALETTE.parchment, 1);
    g.strokeRoundedRect(cx - 12, cy - 26, 24, 22, 9);
    g.fillStyle(PALETTE.ink, 1);
    g.fillRect(cx - 18, cy - 8, 36, 28);
    g.lineStyle(2, PALETTE.parchment, 1);
    g.strokeRect(cx - 18, cy - 8, 36, 28);
    g.fillStyle(PALETTE.mustard, 1);
    g.fillRect(cx - 3, cy + 2, 6, 12);
  }

  private makeExit(): void {
    const g = this.add.graphics().setDepth(5);
    g.fillStyle(PALETTE.brown2, 1);
    g.fillRect(30, 300, 90, 240);
    g.lineStyle(3, PALETTE.ink, 1);
    g.strokeRect(30, 300, 90, 240);
    g.fillStyle(PALETTE.brown, 1);
    g.fillRect(42, 312, 66, 216);
    g.lineStyle(2, PALETTE.ink, 1);
    g.strokeRect(42, 312, 66, 216);
    g.fillStyle(PALETTE.mustard, 1);
    g.fillCircle(96, 420, 5);

    this.add
      .text(75, 560, "← Keluar", {
        ...LABEL_STYLE,
        fontSize: "24px",
        color: "#FBF3DE",
        backgroundColor: "#164429",
      })
      .setOrigin(0.5)
      .setPadding(10, 6, 10, 6)
      .setDepth(5);

    const zone = this.add.zone(75, 420, 120, 300).setDepth(5);
    makeInteractable(zone, () => this.scene.start(SceneKey.Village));
  }

  private addHud(): void {
    this.add.text(GAME_WIDTH / 2, 58, "Kantor Koperasi", { ...TITLE_STYLE, fontSize: "28px" }).setOrigin(0.5).setDepth(10);
    this.add
      .text(GAME_WIDTH / 2, 104, "Pilih ruang untuk memulai", { ...LABEL_STYLE, fontSize: "24px" })
      .setOrigin(0.5)
      .setDepth(10);
  }
}
