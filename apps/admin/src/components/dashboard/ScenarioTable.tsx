import { Fragment } from "react";
import type { ScenarioRow } from "../../lib/adminApi";
import { count, pct, score } from "../../lib/formatMetrics";
import { ScenarioAnalyticsPanel } from "./ScenarioAnalyticsPanel";

/** Per-scenario breakdown (SIM-15) + drill-down (SIM-16). Shows session N next to each rate so a
 * tiny-N "100%" isn't read as a strong signal. Clicking a row opens an inline analytics panel
 * below it (one open at a time); clicking the open row again collapses it. */
export function ScenarioTable({
  rows,
  openScenarioId,
  onRowClick,
}: {
  rows: ScenarioRow[];
  openScenarioId: string | null;
  onRowClick: (scenarioId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-forest">Per skenario</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-brown text-left text-ink-soft">
              <th className="py-2 pr-4 font-semibold">Skenario</th>
              <th className="py-2 pr-4 font-semibold">Sesi</th>
              <th className="py-2 pr-4 font-semibold">Penyelesaian</th>
              <th className="py-2 pr-4 font-semibold">Skor rata-rata</th>
              <th className="py-2 pr-4 font-semibold">Hasil (baik/netral/buruk)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = openScenarioId === r.scenario_id;
              return (
                <Fragment key={r.scenario_id}>
                  <tr
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => onRowClick(r.scenario_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(r.scenario_id);
                      }
                    }}
                    className={`cursor-pointer border-b border-brown/40 hover:bg-parchment/60 ${
                      open ? "border-l-4 border-l-forest" : ""
                    }`}
                  >
                    <td className="py-2 pr-4 text-ink">{r.title}</td>
                    <td className="py-2 pr-4 text-ink-soft">{count(r.sessions)}</td>
                    <td className="py-2 pr-4 text-ink-soft">{pct(r.completion_rate)}</td>
                    <td className="py-2 pr-4 text-ink-soft">{score(r.avg_score)}</td>
                    <td className="py-2 pr-4 text-ink-soft">
                      {r.ending_split
                        ? `${pct(r.ending_split.good)} / ${pct(r.ending_split.neutral)} / ${pct(r.ending_split.bad)}`
                        : "—"}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <ScenarioAnalyticsPanel
                          scenarioId={r.scenario_id}
                          title={r.title}
                          onClose={() => onRowClick(r.scenario_id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
