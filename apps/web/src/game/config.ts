import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { VillageScene } from "./scenes/VillageScene";
import { VillageHudScene } from "./scenes/VillageHudScene";
import { KoperasiInteriorScene } from "./scenes/KoperasiInteriorScene";
import { GAME_WIDTH, GAME_HEIGHT } from "./dimensions";

/** Build the Phaser game config for a given parent DOM element. */
export function createGameConfig(
  parent: HTMLElement,
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#164429",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    render: { pixelArt: true, roundPixels: true },
    physics: {
      default: "arcade",
      arcade: { debug: false }, // top-down: gravity defaults to 0,0
    },
    scene: [
      BootScene,
      PreloadScene,
      VillageScene,
      VillageHudScene,
      KoperasiInteriorScene,
    ],
  };
}
