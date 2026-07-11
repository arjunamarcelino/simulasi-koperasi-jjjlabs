import { memo } from "react";
import type { ConnectionState, DriftLevel } from "../../session/transport/contract";

/**
 * Top status bar for the session overlay: NPC name-plate (left), and the tension
 * meter + connection pill + close button (right). The bar itself is
 * pointer-events-none so it never blocks the map; only its buttons opt back in.
 */
const PILL: Record<ConnectionState, { cls: string; label: string }> = {
  idle: { cls: "bg-cream text-ink-soft", label: "Diam" },
  connecting: { cls: "bg-mustard text-ink", label: "Menyambungkan…" },
  connected: { cls: "bg-forest text-cream", label: "Tersambung" },
  ended: { cls: "bg-brown text-cream", label: "Selesai" },
  error: { cls: "bg-orange text-ink", label: "Gagal" },
};

// Colour of the lit pips at each drift level (all lit pips share the level colour).
const DRIFT_COLOR: Record<DriftLevel, string> = {
  0: "bg-forest",
  1: "bg-mustard",
  2: "bg-orange",
};

export const SessionStatusBar = memo(function SessionStatusBar({
  npcName,
  driftLevel,
  connection,
  onClose,
}: {
  npcName: string;
  driftLevel: DriftLevel;
  connection: ConnectionState;
  onClose: () => void;
}) {
  const pill = PILL[connection];
  const litColor = DRIFT_COLOR[driftLevel];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3">
      <span className="pixel-raise border-3 border-border bg-forest px-3 py-2 font-display text-[10px] text-cream">
        {npcName}
      </span>

      <div className="flex items-center gap-2">
        <div className="pixel-raise flex items-center gap-1.5 border-3 border-border bg-cream/90 px-3 py-2">
          <span className="font-display text-[8px] text-ink-soft">Drift</span>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 border-2 border-border ${
                i <= driftLevel ? litColor : "bg-parchment"
              }`}
            />
          ))}
        </div>

        <span
          className={`border-3 border-border px-3 py-2 font-display text-[9px] ${pill.cls}`}
        >
          {pill.label}
        </span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup sesi"
          title="Tutup sesi"
          className="pixel-raise active:pixel-press pointer-events-auto flex h-10 w-10 items-center justify-center border-3 border-border bg-cream font-display text-sm text-forest transition-transform duration-75 focus-visible:pixel-focus focus-visible:outline-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
});
