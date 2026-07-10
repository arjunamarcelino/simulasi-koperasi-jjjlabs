import { PixelPanel } from "../components/common/PixelPanel";
import { GameButton } from "../components/common/GameButton";
import { gameStore } from "../stores/game.store";

/**
 * Placeholder for the Phaser game view. The tilemap world, player, NPCs and
 * dialogue arrive in a later iteration; the GameCanvas mount seam lives here.
 */
export function GamePage() {
  const back = () => gameStore.getState().setView("SCENARIO_SELECTION");

  return (
    <main className="koperasi-bg flex min-h-screen w-full items-center justify-center px-4 py-8">
      <PixelPanel className="max-w-lg text-center">
        <h1 className="mb-4 font-display text-lg text-forest">Dunia Permainan</h1>
        <p className="mb-6 font-body text-xl text-ink-soft">
          Peta dan interaksi permainan akan hadir di iterasi berikutnya.
        </p>
        <GameButton variant="ghost" onClick={back}>
          ◀ Kembali
        </GameButton>
      </PixelPanel>
    </main>
  );
}
