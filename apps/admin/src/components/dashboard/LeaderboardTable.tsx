import type { LeaderboardEntry } from "../../lib/adminApi";
import { count } from "../../lib/formatMetrics";

/** Standings table for one season (SIM-17), mirroring ScenarioTable. Ranks are contiguous 1..N
 * (the backend guarantees it; the guard rejects duplicates). An empty season renders a "0 peserta"
 * empty state rather than a headerless table. Never shows user_id (not in the contract). */
export function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-ink-soft">0 peserta — musim ini belum memiliki entri.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-brown text-left text-ink-soft">
            <th className="py-2 pr-4 font-semibold">Peringkat</th>
            <th className="py-2 pr-4 font-semibold">Nama</th>
            <th className="py-2 pr-4 font-semibold">XP</th>
            <th className="py-2 pr-4 font-semibold">Level</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.rank} className="border-b border-brown/40">
              <td className="py-2 pr-4 text-ink-soft">{e.rank}</td>
              <td className="py-2 pr-4 font-medium text-forest">{e.display_name}</td>
              <td className="py-2 pr-4 text-ink-soft">{count(e.xp)}</td>
              <td className="py-2 pr-4 text-ink-soft">{count(e.level)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
