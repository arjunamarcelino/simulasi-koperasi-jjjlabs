import { PixelPanel } from "../components/common/PixelPanel";
import { GameButton } from "../components/common/GameButton";
import { gameStore } from "../stores/game.store";

/**
 * Placeholder for the evaluation report. Scoring pillars and narrative arrive
 * in a later iteration once a scenario is playable end-to-end.
 */
export function EvaluationPage() {
  const back = () => gameStore.getState().setView("SCENARIO_SELECTION");

  return (
    <main className="koperasi-bg flex min-h-screen w-full items-center justify-center px-4 py-8">
      <PixelPanel className="max-w-lg text-center">
        <h1 className="mb-4 font-display text-lg text-forest">Hasil Evaluasi</h1>
        <p className="mb-6 font-body text-xl text-ink-soft">
          Laporan evaluasi keputusan akan hadir di iterasi berikutnya.
        </p>
        <GameButton variant="ghost" onClick={back}>
          ◀ Pilih Skenario Lain
        </GameButton>
      </PixelPanel>
    </main>
  );
}
