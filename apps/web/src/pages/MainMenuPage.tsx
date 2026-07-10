import { useEffect } from "react";
import { PixelPanel } from "../components/common/PixelPanel";
import { GameButton } from "../components/common/GameButton";
import { gameStore } from "../stores/game.store";

/** Pure-CSS cooperative building silhouette — decorative, no assets. */
function CoopBuilding() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-[14%] left-1/2 -translate-x-1/2 opacity-25 md:opacity-30"
    >
      <div className="roof mx-auto h-16 w-72 bg-mustard" />
      <div className="pixel-panel mx-auto flex h-40 w-64 items-center justify-center gap-4 bg-forest !shadow-none">
        <div className="border-3 h-10 w-10 border-border bg-mustard" />
        <div className="border-3 h-10 w-10 border-border bg-mustard" />
        <div className="border-3 h-16 w-10 self-end border-border bg-brown" />
      </div>
    </div>
  );
}

export function MainMenuPage() {
  const start = () => gameStore.getState().setView("SCENARIO_SELECTION");

  // Match the "Tekan Enter untuk mulai" hint with a real keyboard shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        start();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className="koperasi-bg relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-8">
      <CoopBuilding />

      <PixelPanel className="relative z-10 w-full max-w-xl text-center">
        <span className="pixel-panel -rotate-1 mb-6 inline-block bg-orange px-3 py-1 font-body text-lg text-ink !shadow-none">
          JJJ Labs
        </span>

        <h1 className="font-display text-2xl leading-tight text-forest drop-shadow-[3px_3px_0_var(--color-mustard)] md:text-3xl">
          Koperasi
          <br />
          Simulator
        </h1>

        <p className="mb-8 mt-5 font-body text-xl leading-snug text-ink-soft md:text-2xl">
          Jelajahi, Pelajari, dan Kenali Dunia Koperasi
        </p>

        <GameButton variant="primary" onClick={start}>
          ▶ Mulai Bermain
        </GameButton>

        <p className="mt-8 font-body text-lg text-ink-soft/70">
          Tekan Enter untuk mulai
        </p>
      </PixelPanel>
    </main>
  );
}
