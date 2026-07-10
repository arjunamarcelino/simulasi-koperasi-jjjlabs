import Phaser from "phaser";
import { SceneKey } from "./sceneKeys";

/**
 * Entry scene. v1 scenes draw primitives directly (no image assets), so Boot
 * has nothing to load — it hands straight off to the Village. This is where a
 * real loader / placeholder-texture generation would live later.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    this.scene.start(SceneKey.Village);
  }
}
