import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";
import { PALETTE } from "../palette";
import { LABEL_STYLE } from "../textStyles";
import { GAME_WIDTH, GAME_HEIGHT } from "../dimensions";

/**
 * Unzoomed overlay scene for the village, run in parallel with VillageScene.
 * Kept separate because camera zoom in VillageScene would also scale a
 * same-scene HUD. Reads the door-proximity flag from the game registry.
 */
export class VillageHudScene extends Phaser.Scene {
  private prompt!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.VillageHud);
  }

  create(): void {
    const cx = GAME_WIDTH / 2;

    this.add
      .rectangle(cx, GAME_HEIGHT - 30, 520, 40, PALETTE.parchment, 0.9)
      .setStrokeStyle(3, PALETTE.ink);
    this.add
      .text(cx, GAME_HEIGHT - 30, "WASD / panah untuk bergerak", { ...LABEL_STYLE, fontSize: "22px" })
      .setOrigin(0.5);

    this.prompt = this.add
      .text(cx, GAME_HEIGHT / 2 + 60, "Tekan E untuk masuk", {
        ...LABEL_STYLE,
        fontSize: "22px",
        color: "#FBF3DE",
        backgroundColor: "#164429",
      })
      .setOrigin(0.5)
      .setPadding(10, 6, 10, 6)
      .setVisible(false);
  }

  override update(): void {
    this.prompt.setVisible(this.registry.get("villageNearDoor") === true);
  }
}
