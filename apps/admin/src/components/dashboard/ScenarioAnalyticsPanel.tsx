import type { ScenarioAnalytics } from "../../lib/adminApi";
import { useScenarioAnalytics, scenarioAnalyticsStore } from "../../stores/scenarioAnalytics.store";
import { count, score } from "../../lib/formatMetrics";
import { KpiCard } from "./KpiCard";
import { DistributionBars } from "./DistributionBars";

const LOW_N = 5;

/**
 * Per-scenario drill-down panel (SIM-16), rendered inline under the clicked ScenarioTable row.
 * Reads the single-slot scenarioAnalytics store; renders loading / error / notFound / authLost /
 * ready. All content states keep the header + "Tutup" visible so the admin never loses their place.
 */
export function ScenarioAnalyticsPanel({
  scenarioId,
  title,
  onClose,
}: {
  scenarioId: string;
  title: string;
  onClose: () => void;
}) {
  const state = useScenarioAnalytics((s) => s.state);
  // Single-slot store: only render for the scenario this panel belongs to (defensive).
  if (state.status === "idle" || state.scenarioId !== scenarioId) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-brown/40 bg-parchment/40 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-forest">Analitik — {title}</h3>
        <button onClick={onClose} className="text-xs text-ink-soft underline">
          Tutup
        </button>
      </div>

      {state.status === "loading" || state.status === "authLost" ? (
        <p className="text-ink-soft">Memuat analitik skenario…</p>
      ) : state.status === "notFound" ? (
        <p className="text-ink-soft">Skenario tidak ditemukan.</p>
      ) : state.status === "error" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ink-soft">Tidak dapat memuat analitik saat ini.</p>
          <button
            onClick={() => scenarioAnalyticsStore.getState().retry()}
            className="rounded bg-forest px-4 py-2 font-semibold text-cream"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <PanelBody data={state.data} />
      )}
    </div>
  );
}

function PanelBody({ data }: { data: ScenarioAnalytics }) {
  const { attempts, outcome, avg_score, pillars } = data;
  return (
    <div className="flex flex-col gap-3">
      {/* Always-visible caveat: "attempts" = recorded endings only (SIM-16 flow decision). */}
      <p className="text-xs text-ink-soft">
        Berdasarkan sesi yang tercatat selesai; keluar di tengah sesi belum tertangkap.
      </p>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Percobaan"
          value={count(attempts)}
          sub={`${count(outcome.completed)} selesai · ${count(outcome.bubar)} BUBAR`}
        />
        <KpiCard label="Skor rata-rata" value={score(avg_score)} sub="dari 0–100" />
        <KpiCard
          label="Hasil (baik/netral/buruk)"
          value={`${count(outcome.ending_counts.good)} / ${count(outcome.ending_counts.neutral)} / ${count(outcome.ending_counts.bad)}`}
        />
      </section>
      <p className="text-xs text-ink-soft">
        Pemicu akhir: manual {count(outcome.by_trigger["manual"] ?? 0)} · sinyal L1{" "}
        {count(outcome.by_trigger["sinyal_level_1"] ?? 0)} · force-quit{" "}
        {count(outcome.by_trigger["force_quit_level_2"] ?? 0)}
      </p>

      {attempts === 0 ? (
        <p className="text-ink-soft">Belum ada sesi untuk skenario ini.</p>
      ) : pillars.length === 0 ? (
        <p className="text-ink-soft">Skenario ini tidak memiliki skor pilar.</p>
      ) : (
        <>
          {attempts < LOW_N && (
            <p className="text-xs text-ink-soft">{`Data terbatas (N<${LOW_N}) — distribusi belum tentu representatif.`}</p>
          )}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {pillars.map((p) => (
              <DistributionBars key={p.key} pillarKey={p.key} buckets={p.buckets} avg={p.avg} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
