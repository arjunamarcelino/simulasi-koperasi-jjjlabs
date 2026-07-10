import { useSessionStore } from "../stores/session.store";

const PIP_COLOR = ["bg-forest", "bg-mustard", "bg-orange"] as const;

/**
 * Indikator ketegangan (PRD Bagian 6 Lapisan 2 / Bagian 9).
 *
 * Untuk Skenario 1 ini INERT — tutorial tidak menjalankan observer drift, jadi
 * level selalu 0. Komponennya tetap dirender supaya jalur datanya terbukti
 * ter-wire sebelum Skenario 2-4 benar-benar menggerakkannya.
 */
export function DriftMeter() {
  const level = useSessionStore((s) => s.driftLevel);

  return (
    <div className="flex items-center gap-2" title="Level drift (PRD Lapisan 2)">
      <span className="text-xs uppercase tracking-wide text-ink-soft">
        Ketegangan
      </span>
      <div className="flex gap-1">
        {[0, 1, 2].map((pip) => (
          <span
            key={pip}
            className={`h-3 w-6 rounded-sm ${
              pip <= level ? PIP_COLOR[level] : "bg-line/40"
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-ink-soft">L{level}</span>
    </div>
  );
}
