import { GameCanvas } from "../components/game/GameCanvas";
import { HubOverlays } from "../components/hub/HubOverlays";
import { HubGuide } from "../components/hub/HubGuide";
import { KoperasiExitButton } from "../components/hub/KoperasiExitButton";
import { NamePrompt } from "../components/hub/NamePrompt";
import { useGameStore } from "../stores/game.store";

/**
 * The spatial hub (Village → Koperasi Interior). Hosts the Phaser canvas with
 * React chrome (HUD) and decision overlays layered on top. Rendered for the
 * SCENARIO_SELECTION view.
 */
export function HubPage() {
  const needsName = useGameStore((s) => s.playerName === null);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-forest-2">
      <GameCanvas />
      <HubGuide />
      <KoperasiExitButton />
      <HubOverlays />
      {needsName && <NamePrompt />}
    </main>
  );
}
