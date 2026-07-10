import { PixelPanel } from "../components/common/PixelPanel";
import { GameButton } from "../components/common/GameButton";
import { gameStore } from "../stores/game.store";
import { SCENARIOS } from "../scenarios/scenario.config";
import type { ScenarioConfig } from "../types/scenario";

function StatusBadge({ status }: { status: ScenarioConfig["status"] }) {
  const isAvailable = status === "AVAILABLE";
  return (
    <span
      className={`border-3 inline-block border-border px-2 py-0.5 font-body text-base ${
        isAvailable ? "bg-mustard text-ink" : "bg-cream text-ink-soft"
      }`}
    >
      {isAvailable ? "Tersedia" : "Segera Hadir"}
    </span>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioConfig }) {
  const isAvailable = scenario.status === "AVAILABLE";
  return (
    <PixelPanel className={`text-left ${isAvailable ? "" : "opacity-70"}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <h2 className="font-display text-sm text-forest">{scenario.title}</h2>
        <StatusBadge status={scenario.status} />
      </div>
      <p className="mb-3 font-body text-lg text-ink-soft">
        {scenario.shortDescription}
      </p>
      <p className="font-body text-base text-ink-soft/80">
        Tingkat: {scenario.difficulty}
      </p>
    </PixelPanel>
  );
}

/**
 * Iteration-1 placeholder: renders the config-driven scenario list read-only.
 * Playable scenario flow (map, dialogue, decision) arrives in a later iteration.
 */
export function ScenarioSelectionPage() {
  const back = () => gameStore.getState().setView("MAIN_MENU");

  return (
    <main className="koperasi-bg min-h-screen w-full overflow-y-auto px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <h1 className="font-display text-xl text-forest drop-shadow-[2px_2px_0_var(--color-mustard)]">
            Pilih Skenario
          </h1>
          <p className="mt-4 font-body text-xl text-ink-soft">
            Alur skenario yang dapat dimainkan akan hadir di iterasi berikutnya.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {SCENARIOS.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} />
          ))}
        </div>

        <div className="mt-10 text-center">
          <GameButton variant="ghost" onClick={back}>
            ◀ Kembali
          </GameButton>
        </div>
      </div>
    </main>
  );
}
