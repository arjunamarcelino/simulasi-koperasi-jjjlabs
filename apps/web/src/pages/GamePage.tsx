import { PixelPanel } from "../components/common/PixelPanel";
import { GameButton } from "../components/common/GameButton";
import { gameStore, useGameStore } from "../stores/game.store";
import { SCENARIOS } from "../scenarios/scenario.config";
import { SessionPage } from "./SessionPage";

/**
 * Routes a selected scenario: voice scenarios render the live SessionPage; the
 * rest show a stub until their mechanics are built.
 */
export function GamePage() {
  const scenarioId = useGameStore((s) => s.selectedScenarioId);
  const scenario = SCENARIOS.find((sc) => sc.id === scenarioId) ?? null;
  const back = () => gameStore.getState().setView("SCENARIO_SELECTION");

  // Scenario 1 (tutorial) runs as a live voice session.
  if (scenarioId === "tutorial-koperasi-konsumen") {
    return <SessionPage scenarioId={scenarioId} />;
  }

  return (
    <main className="koperasi-bg flex min-h-screen w-full items-center justify-center px-4 py-8">
      <PixelPanel className="max-w-lg text-center">
        <h1 className="mb-4 font-display text-lg text-forest">
          {scenario?.title ?? "Skenario"}
        </h1>
        <p className="mb-6 font-body text-xl text-ink-soft">
          Skenario ini segera dapat dimainkan. Nantikan alur permainannya —
          agenda rapat, musyawarah anggota, dan pengambilan keputusan.
        </p>
        <GameButton variant="ghost" onClick={back}>
          ◀ Kembali ke Kantor Koperasi
        </GameButton>
      </PixelPanel>
    </main>
  );
}
