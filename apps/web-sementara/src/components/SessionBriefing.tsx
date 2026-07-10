import { getScenarioMeta } from "../scenarios/catalog";
import { useSessionStore } from "../stores/session.store";

/**
 * Panel briefing dalam sesi: menjelaskan misi & langkah "yang perlu kamu
 * lakukan" untuk skenario aktif. Membantu pemain (terutama yang belum paham
 * koperasi) tahu harus mulai dari mana. Collapsible, terbuka secara default.
 */
export function SessionBriefing() {
  const scenarioId = useSessionStore((s) => s.scenarioId);
  const meta = getScenarioMeta(scenarioId);

  return (
    <details
      open
      className="rounded-lg border border-line bg-parchment px-3 py-2 text-sm"
    >
      <summary className="cursor-pointer font-semibold">
        Misi & Petunjuk Langkah
      </summary>
      <p className="mt-2 leading-relaxed">{meta.mission}</p>
      <p className="mt-2 font-semibold text-ink-soft">Yang perlu kamu lakukan:</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 leading-relaxed">
        {meta.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-ink-soft">
        Masih bingung di tengah sesi? Tekan tombol <strong>Petunjuk</strong> untuk
        saran sesuai keadaan percakapan.
      </p>
    </details>
  );
}
