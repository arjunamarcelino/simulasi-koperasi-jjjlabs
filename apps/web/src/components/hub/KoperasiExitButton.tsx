import { useGameStore, gameStore } from "../../stores/game.store";

/**
 * Top-right door icon (mirrors the "?" guide top-left). Only shown inside the
 * koperasi interior; clicking it leaves back to the village — an alternative to
 * walking to the exit door and pressing E.
 */
export function KoperasiExitButton() {
  const inside = useGameStore((s) => s.activeHubScene === "KoperasiInterior");
  if (!inside) return null;

  return (
    <button
      type="button"
      onClick={() => gameStore.getState().requestKoperasiExit()}
      aria-label="Keluar koperasi"
      title="Keluar koperasi"
      className="pixel-raise active:pixel-press pointer-events-auto absolute right-4 top-4 z-20 flex h-12 w-12 items-center justify-center bg-mustard text-ink focus-visible:pixel-focus focus-visible:outline-none"
    >
      {/* Pixel-art exit: a wooden door with a forest-green arrow leaving it,
          matching the game's tilemap palette (brown door, ink outline). */}
      <svg viewBox="0 0 16 16" width="30" height="30" shapeRendering="crispEdges" aria-hidden="true">
        {/* door slab + panels + knob */}
        <rect x="1" y="2" width="6" height="12" fill="#7A4E2D" stroke="#2B2016" strokeWidth="1" />
        <rect x="2" y="3" width="4" height="4" fill="#5A3A20" />
        <rect x="2" y="9" width="4" height="4" fill="#5A3A20" />
        <rect x="5" y="7" width="1" height="2" fill="#D9A521" />
        {/* exit arrow (forest green): shaft + staircase head, emerging right */}
        <rect x="7" y="7" width="3" height="2" fill="#1F5D3A" />
        <rect x="10" y="5" width="1" height="6" fill="#1F5D3A" />
        <rect x="11" y="6" width="1" height="4" fill="#1F5D3A" />
        <rect x="12" y="7" width="1" height="2" fill="#1F5D3A" />
      </svg>
    </button>
  );
}
