import { GameCanvas } from "../components/game/GameCanvas";
import { HubOverlays } from "../components/hub/HubOverlays";
import { HubHud } from "../components/hub/HubHud";

/**
 * The spatial hub (Village → Koperasi Interior). Hosts the Phaser canvas with
 * React chrome (HUD) and decision overlays layered on top. Rendered for the
 * SCENARIO_SELECTION view.
 */
export function HubPage() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-forest-2">
      <GameCanvas />
      <HubHud />
      <HubOverlays />
    </main>
  );
}
