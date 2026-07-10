import { gameStore } from "../../stores/game.store";

/**
 * Top-left mission icon, right of the profile icon (left-4 "?", left-20 profile,
 * left-36 mission). Opens the mission overlay. Stays at z-20 (below the modal
 * backdrop's z-30).
 */
export function MissionIcon() {
  return (
    <button
      type="button"
      onClick={() => gameStore.getState().openMission()}
      aria-label="Mission"
      title="Mission"
      className="pixel-raise active:pixel-press pointer-events-auto absolute left-36 top-4 z-20 flex h-12 w-12 items-center justify-center bg-mustard text-ink focus-visible:pixel-focus focus-visible:outline-none"
    >
      {/* Pixel-art clipboard/checklist (matches the tilemap palette). */}
      <svg viewBox="0 0 16 16" width="30" height="30" shapeRendering="crispEdges" aria-hidden="true">
        {/* clip tab + paper body */}
        <rect x="6" y="1" width="4" height="2" fill="#7A4E2D" stroke="#2B2016" strokeWidth="1" />
        <rect x="3" y="2" width="10" height="13" fill="#F4E6C8" stroke="#2B2016" strokeWidth="1" />
        {/* two checked rows */}
        <rect x="4" y="5" width="2" height="2" fill="#1F5D3A" />
        <rect x="7" y="5" width="5" height="1" fill="#7A4E2D" />
        <rect x="4" y="8" width="2" height="2" fill="#1F5D3A" />
        <rect x="7" y="8" width="5" height="1" fill="#7A4E2D" />
        {/* one empty row */}
        <rect x="4" y="11" width="2" height="2" fill="#F4E6C8" stroke="#2B2016" strokeWidth="1" />
        <rect x="7" y="11" width="4" height="1" fill="#7A4E2D" />
      </svg>
    </button>
  );
}
