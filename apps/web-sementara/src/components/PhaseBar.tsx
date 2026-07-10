import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";

/**
 * Indikator + kontrol fase RAT (PRD §7.4). Hanya tampil bila sesi punya fase.
 * Tombol aksi agenda memajukan fase; di fase terakhir tombolnya hilang dan
 * pengakhiran diserahkan ke "Keputusan Akhir".
 */
export function PhaseBar() {
  const phase = useSessionStore((s) => s.phase);
  const connected = useSessionStore((s) => s.connection === "connected");

  if (!phase) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-cream-2/40 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-forest px-2 py-0.5 text-xs font-semibold text-cream">
          Fase {phase.phase}/3
        </span>
        <span className="font-semibold">{phase.label}</span>
      </div>
      {phase.advanceActionLabel && (
        <button
          type="button"
          disabled={!connected}
          onClick={sessionController.advancePhase}
          className="rounded-lg bg-forest px-4 py-2 text-sm font-semibold text-cream disabled:opacity-40"
        >
          {phase.advanceActionLabel} →
        </button>
      )}
    </div>
  );
}
