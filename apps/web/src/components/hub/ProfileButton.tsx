import { gameStore } from "../../stores/game.store";

/**
 * Top-left profile icon, sits just right of the "?" guide button. Opens the
 * profile modal. Stays at z-20 (below the modal backdrop's z-30) so it never
 * punches through an open overlay.
 */
export function ProfileButton() {
  return (
    <button
      type="button"
      onClick={() => gameStore.getState().openProfile()}
      aria-label="Profil anggota"
      title="Profil anggota"
      className="pixel-raise active:pixel-press pointer-events-auto absolute left-20 top-4 z-20 flex h-12 w-12 items-center justify-center bg-mustard text-ink focus-visible:pixel-focus focus-visible:outline-none"
    >
      {/* Pixel-art membership ID card (matches the tilemap palette). */}
      <svg viewBox="0 0 16 16" width="30" height="30" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="1" y="3" width="14" height="10" fill="#F4E6C8" stroke="#2B2016" strokeWidth="1" />
        <rect x="2" y="4" width="5" height="5" fill="#1F5D3A" />
        <rect x="3" y="5" width="2" height="2" fill="#D9A521" />
        <rect x="3" y="7" width="3" height="2" fill="#D9A521" />
        <rect x="8" y="5" width="5" height="1" fill="#7A4E2D" />
        <rect x="8" y="7" width="5" height="1" fill="#7A4E2D" />
        <rect x="8" y="9" width="3" height="1" fill="#7A4E2D" />
        <rect x="2" y="11" width="11" height="1" fill="#1F5D3A" />
      </svg>
    </button>
  );
}
