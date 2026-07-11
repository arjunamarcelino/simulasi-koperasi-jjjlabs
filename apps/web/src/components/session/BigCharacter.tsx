import { memo, type CSSProperties } from "react";

/**
 * A big visual-novel character (or a small name-plate "face"), drawn by
 * CSS-cropping frame 0 (down-idle) of a 16x16 spritesheet and scaling it up with
 * nearest-neighbour. No new art — the same sheets Phaser already loads.
 *
 * NPC = samurai_green (4 cols × 7 rows), player = villager (8 cols × 4 rows).
 * "npc-alt" reuses the samurai sheet with a hue-rotate so a second on-screen NPC
 * (RAT: Ibu Sri vs Pak Darma) reads as a distinct character without new art —
 * hue-rotate shifts colour only, so scaled pixels stay crisp (unlike blur).
 * The active speaker stays full; the listener dims + steps back a hair. Emphasis
 * is opacity + translate only (never blur/filter, which muddies scaled pixels).
 */
type Role = "player" | "npc" | "npc-alt";

const SHEETS: Record<Role, { src: string; cols: number; rows: number; hue?: number }> = {
  player: { src: "/assets/ninja/villager.png", cols: 8, rows: 4 },
  npc: { src: "/assets/ninja/samurai_green.png", cols: 4, rows: 7 },
  "npc-alt": { src: "/assets/ninja/samurai_green.png", cols: 4, rows: 7, hue: 200 },
};

function cropStyle(role: Role, px: number): CSSProperties {
  const { src, cols, rows, hue } = SHEETS[role];
  const scale = px / 16; // frames are 16px
  return {
    width: px,
    height: px,
    backgroundImage: `url(${src})`,
    backgroundSize: `${cols * 16 * scale}px ${rows * 16 * scale}px`,
    backgroundPosition: "0 0", // frame 0 = top-left
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
    // Colour-only shift for a distinct second persona; keeps pixels crisp.
    filter: hue ? `hue-rotate(${hue}deg)` : undefined,
  };
}

export const BigCharacter = memo(function BigCharacter({
  role,
  active,
  size = "big",
}: {
  role: Role;
  active: boolean;
  size?: "big" | "face";
}) {
  if (size === "face") {
    return (
      <div
        aria-hidden="true"
        className="shrink-0 border-3 border-border bg-parchment"
        style={cropStyle(role, 44)}
      />
    );
  }

  // NPC (left) mirrors to face the player on the right; the player mirrors back.
  const flip = role === "player";
  return (
    <div
      aria-hidden="true"
      className="flex flex-col items-center transition-[opacity,transform] duration-200 ease-out"
      style={{ opacity: active ? 1 : 0.5, transform: active ? "none" : "translateY(2px)" }}
    >
      <div
        style={{ ...cropStyle(role, 144), transform: flip ? "scaleX(-1)" : undefined }}
      />
      {/* Oval foot shadow (hard-edged, no blur) grounds the character. */}
      <div className="mt-1 h-2 w-24 rounded-[50%] bg-ink/25" />
    </div>
  );
});
