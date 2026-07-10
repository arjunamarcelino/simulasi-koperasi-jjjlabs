import Phaser from "phaser";

/** VT323 for labels/hints — crisp and retro at 1280x720 (monospace fallback). */
export const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"VT323","Courier New",monospace',
  fontSize: "28px",
  color: "#2B2016",
  stroke: "#FBF3DE",
  strokeThickness: 4,
};

/** Press Start 2P reserved for short scene titles. */
export const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Press Start 2P",monospace',
  fontSize: "28px",
  color: "#FBF3DE",
  stroke: "#164429",
  strokeThickness: 6,
};
