import { useEffect } from "react";
import { dashboardMetricsStore, useDashboardMetrics } from "../../stores/dashboardMetrics.store";
import { scenarioAnalyticsStore, useScenarioAnalytics } from "../../stores/scenarioAnalytics.store";
import { leaderboardStore } from "../../stores/leaderboard.store";
import { KpiCard } from "./KpiCard";
import { ScenarioTable } from "./ScenarioTable";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { count, pct, score } from "../../lib/formatMetrics";

/**
 * Admin dashboard metrics (SIM-15). Its own fetch-state machine (NOT the auth gate); the
 * retry here refetches /admin/metrics. `authLost` is passive — the gate re-probe it fired
 * drives the transition back to login / not-authorized.
 */
export function DashboardPage({ userId }: { userId: string }) {
  const state = useDashboardMetrics((s) => s.state);
  // Narrow selector: re-render only when the OPEN scenario changes, not on every panel-content
  // transition (loading→ready→error) of the drill-down store.
  const openScenarioId = useScenarioAnalytics((s) =>
    s.state.status === "idle" ? null : s.state.scenarioId,
  );

  useEffect(() => {
    dashboardMetricsStore.getState().load(userId); // fetch once per authorized userId
    leaderboardStore.getState().load(); // fetch the latest season once (StrictMode-safe)
    // One unmount owner: tear down the dashboard fetch, any open drill-down panel, and the board.
    return () => {
      dashboardMetricsStore.getState().dispose();
      scenarioAnalyticsStore.getState().close();
      leaderboardStore.getState().dispose();
    };
  }, [userId]);

  if (state.status === "loading" || state.status === "authLost") {
    return <p className="text-ink-soft">Memuat dasbor…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-soft">Tidak dapat memuat metrik saat ini.</p>
        <button
          onClick={() => dashboardMetricsStore.getState().retry()}
          className="rounded bg-forest px-4 py-2 font-semibold text-cream"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  const { users, sessions, per_scenario } = state.data;
  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Pengguna aktif (30 hari)"
          value={count(users.active_30d)}
          sub={`${count(users.total_registered)} total · ${count(users.new_7d)} baru (7 hari)`}
        />
        <KpiCard
          label="Tingkat penyelesaian"
          value={pct(sessions.completion_rate)}
          sub={`${count(sessions.total)} sesi`}
        />
        <KpiCard label="Skor rata-rata" value={score(sessions.avg_score)} sub="dari 0–100" />
      </section>
      {sessions.ending_split && (
        <p className="text-sm text-ink-soft">
          Hasil sesi: baik {pct(sessions.ending_split.good)} · netral{" "}
          {pct(sessions.ending_split.neutral)} · buruk {pct(sessions.ending_split.bad)}
        </p>
      )}
      {sessions.total === 0 ? (
        <p className="text-ink-soft">Belum ada data.</p>
      ) : (
        <ScenarioTable
          rows={per_scenario}
          openScenarioId={openScenarioId}
          onRowClick={(id) => scenarioAnalyticsStore.getState().open(id)}
        />
      )}
      <section className="border-t border-brown/40 pt-6">
        <LeaderboardPanel />
      </section>
    </div>
  );
}
