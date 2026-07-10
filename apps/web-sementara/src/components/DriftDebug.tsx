import { ENV } from "../config/env";
import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";
import type { DriftLevel } from "../transport/contract.provisional";

const LEVELS: DriftLevel[] = [0, 1, 2];

/**
 * Alat demo — memaksa level drift tanpa harus mengetik kasar berulang. Hanya
 * muncul di mode mock; di jalur LiveKit drift datang dari observer asli.
 */
export function DriftDebug() {
  const level = useSessionStore((s) => s.driftLevel);
  const connected = useSessionStore((s) => s.connection === "connected");

  if (ENV.transport !== "mock") return null;

  return (
    <div className="flex items-center gap-2 text-xs text-ink-soft">
      <span className="uppercase tracking-wide">Debug drift</span>
      {LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          disabled={!connected}
          onClick={() => sessionController.debugSetDrift(l)}
          className={`rounded border border-line px-2 py-1 disabled:opacity-40 ${
            l === level ? "bg-forest text-cream" : "bg-parchment"
          }`}
        >
          L{l}
        </button>
      ))}
    </div>
  );
}
