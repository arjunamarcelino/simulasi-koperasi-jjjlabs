import { RAT_LPJ_SUMMARY } from "../scenarios/lpj";
import { useSessionStore } from "../stores/session.store";

/**
 * Ringkasan LPJ untuk RAT (Skenario 4). Tampil saat fase "Baca LPJ" atau "Ambil
 * Keputusan" (fase ≥ 2) supaya pemain membaca isi laporan sebelum memutuskan,
 * bukan asal menekan tombol. Collapsible, terbuka default.
 */
export function LpjPanel() {
  const scenarioId = useSessionStore((s) => s.scenarioId);
  const phase = useSessionStore((s) => s.phase);

  if (scenarioId !== "rapat-anggota-tahunan") return null;
  if (!phase || phase.phase < 2) return null;

  return (
    <details
      open
      className="rounded-lg border border-line bg-parchment px-3 py-2 text-sm"
    >
      <summary className="cursor-pointer font-semibold">
        {RAT_LPJ_SUMMARY.title}
      </summary>
      <dl className="mt-2 space-y-2">
        {RAT_LPJ_SUMMARY.sections.map((s, i) => (
          <div key={i}>
            <dt className="font-semibold text-ink-soft">{s.heading}</dt>
            <dd className="leading-relaxed">{s.body}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-soft">
        Baca ringkasan ini lebih dulu sebelum menekan tombol keputusan.
      </p>
    </details>
  );
}
