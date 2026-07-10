import { useEffect, useState } from "react";
import { PixelPanel } from "../components/common/PixelPanel";
import { gameStore } from "../stores/game.store";
import { KOPERASI_FACTS } from "../content/koperasi-facts";

const DURATION_MS = 5000;
const FACT_INTERVAL_MS = 1700; // ~3 facts across the 5s

/**
 * Simulated loading screen between the main menu and the game world. Fills a
 * progress bar over ~5s while rotating cooperative fun facts, then auto-continues.
 */
export function LoadingPage() {
  const [progress, setProgress] = useState(0);
  const [factIndex, setFactIndex] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        gameStore.getState().setView("SCENARIO_SELECTION");
      }
    };
    raf = requestAnimationFrame(tick);

    const factTimer = window.setInterval(() => {
      setFactIndex((i) => (i + 1) % KOPERASI_FACTS.length);
    }, FACT_INTERVAL_MS);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(factTimer);
    };
  }, []);

  const fact = KOPERASI_FACTS[factIndex] ?? KOPERASI_FACTS[0];
  const percent = Math.round(progress * 100);

  return (
    <main className="koperasi-bg-plain flex min-h-screen w-full items-center justify-center px-4 py-8">
      <PixelPanel className="w-full max-w-xl text-center">
        <span className="pixel-panel -rotate-1 mb-6 inline-block bg-mustard px-3 py-1 font-display text-xs text-ink !shadow-none">
          Tahukah Kamu?
        </span>

        <p
          key={factIndex}
          className="mx-auto mb-8 min-h-24 max-w-md font-body text-xl leading-snug text-ink-soft md:text-2xl"
        >
          {fact}
        </p>

        {/* progress bar (pixel style) */}
        <div className="mx-auto h-6 w-full max-w-md border-3 border-border bg-forest-2">
          <div
            className="h-full bg-mustard transition-[width] duration-100 ease-linear"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-3 font-body text-lg text-ink-soft/80">
          Memuat dunia koperasi… {percent}%
        </p>
      </PixelPanel>
    </main>
  );
}
