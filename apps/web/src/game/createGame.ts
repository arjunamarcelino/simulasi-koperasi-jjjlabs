import Phaser from "phaser";
import { createGameConfig } from "./config";

/**
 * Single entry point for constructing the Phaser game. Called by the React
 * `GameCanvas` bridge, which owns the instance lifecycle (create/destroy).
 */
export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game(createGameConfig(parent));
}
