import { PixelPanel } from "../common/PixelPanel";

/**
 * Shown from the moment a scenario ends (the player's end action or a force-quit) until
 * the AI Auditor's result arrives, so the wait reads as "your session is being assessed"
 * instead of a frozen scene. The auditor may retry or switch to a fallback model, which
 * can take a little while.
 */
export function EvaluatingPanel() {
  return (
    <PixelPanel className="max-w-sm text-center">
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <p className="animate-pulse font-display text-xs text-ink">Sedang menyusun evaluasi…</p>
        <p className="font-body text-lg leading-snug text-ink-soft">
          Sesi Anda sedang dinilai. Mohon tunggu sebentar.
        </p>
      </div>
    </PixelPanel>
  );
}
