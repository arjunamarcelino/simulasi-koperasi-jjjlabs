import { useEffect, useState } from "react";
import { PixelPanel } from "../common/PixelPanel";
import { useGameStore } from "../../stores/game.store";

const DURATION_MS = 4500; // matches the scene's delayedCall before transition (time to read)

/**
 * Brief loading overlay shown while entering/leaving the koperasi. Displays a
 * single hardcoded trivia (different for enter vs exit) and a short progress
 * bar. Driven by `sceneLoading` in the store; the target scene's `create()`
 * clears it, which unmounts this overlay.
 */
export function SceneLoadingOverlay() {
  const text = useGameStore((s) => s.sceneLoading);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!text) return;
    setProgress(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setProgress(Math.min(1, (now - start) / DURATION_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  if (!text) return null;
  const percent = Math.round(progress * 100);

  return (
    <div className="koperasi-bg-plain absolute inset-0 z-50 flex items-center justify-center px-4 py-8">
      <PixelPanel className="w-full max-w-xl text-center">
        <span className="pixel-panel -rotate-1 mb-6 inline-block bg-mustard px-3 py-1 font-display text-xs text-ink !shadow-none">
          Tahukah Kamu?
        </span>

        <p className="mx-auto mb-8 min-h-24 max-w-md font-body text-xl leading-snug text-ink-soft md:text-2xl">
          {text}
        </p>

        <div className="mx-auto h-6 w-full max-w-md border-3 border-border bg-forest-2">
          <div
            className="h-full bg-mustard transition-[width] duration-100 ease-linear"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-3 font-body text-lg text-ink-soft/80">Memuat… {percent}%</p>
      </PixelPanel>
    </div>
  );
}
