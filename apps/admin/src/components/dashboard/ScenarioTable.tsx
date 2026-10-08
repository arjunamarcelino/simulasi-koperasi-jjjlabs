import type { ScenarioRow } from "../../lib/adminApi";
import { count, pct, score } from "../../lib/formatMetrics";

/** Per-scenario breakdown (SIM-15). Shows session N next to each rate so a tiny-N
 * "100%" isn't read as a strong signal. Null rates render as "—". */
export function ScenarioTable({ rows }: { rows: ScenarioRow[] }) {
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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.scenario_id} className="border-b border-brown/40">
                <td className="py-2 pr-4 text-ink">{r.title}</td>
                <td className="py-2 pr-4 text-ink-soft">{count(r.sessions)}</td>
                <td className="py-2 pr-4 text-ink-soft">{pct(r.completion_rate)}</td>
                <td className="py-2 pr-4 text-ink-soft">{score(r.avg_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
