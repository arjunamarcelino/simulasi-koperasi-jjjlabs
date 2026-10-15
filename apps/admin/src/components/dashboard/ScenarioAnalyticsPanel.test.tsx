// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScenarioAnalyticsPanel } from "./ScenarioAnalyticsPanel";
import {
  scenarioAnalyticsStore,
  __resetScenarioAnalyticsForTest,
  type ScenarioAnalyticsUiState,
} from "../../stores/scenarioAnalytics.store";
import type { ScenarioAnalytics } from "../../lib/adminApi";

afterEach(() => {
  cleanup();
  __resetScenarioAnalyticsForTest();
});

function data(over: Partial<ScenarioAnalytics> = {}): ScenarioAnalytics {
  return {
    scenario_id: "kredit-macet",
    title: "Kredit Macet",
    generated_at: "2026-10-09T04:00:00Z",
    attempts: 9,
    outcome: {
      completed: 8,
      bubar: 1,
      by_trigger: { manual: 7, sinyal_level_1: 1, force_quit_level_2: 1 },
      ending_counts: { good: 6, neutral: 2, bad: 1 },
    },
    avg_score: 46.4,
    pillars: [{ key: "a", count: 4, avg: 20.3, buckets: [2, 2, 0, 0, 0] }],
    dropoff: null,
    ...over,
  };
}

function setState(s: ScenarioAnalyticsUiState) {
  scenarioAnalyticsStore.setState({ state: s });
}

const panel = () =>
  render(<ScenarioAnalyticsPanel scenarioId="kredit-macet" title="Kredit Macet" onClose={vi.fn()} />);

describe("ScenarioAnalyticsPanel", () => {
  it("renders nothing when the store is idle", () => {
    const { container } = panel();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a different scenario (single-slot store)", () => {
    setState({ status: "ready", scenarioId: "other", data: data() });
    const { container } = panel();
    expect(container.firstChild).toBeNull();
  });

  it("loading keeps the header + Tutup control visible", () => {
    setState({ status: "loading", scenarioId: "kredit-macet" });
    panel();
    expect(screen.getByText(/Memuat analitik/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tutup" })).toBeTruthy();
  });

  it("notFound shows a message with NO retry button", () => {
    setState({ status: "notFound", scenarioId: "kredit-macet" });
    panel();
    expect(screen.getByText("Skenario tidak ditemukan.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });

  it("error shows a retry button", () => {
    setState({ status: "error", scenarioId: "kredit-macet" });
    panel();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });

  it("ready renders the recorded-endings caveat + distribution bars", () => {
    setState({ status: "ready", scenarioId: "kredit-macet", data: data() });
    panel();
    expect(screen.getByText(/tercatat selesai/)).toBeTruthy();
    expect(screen.getByRole("img")).toBeTruthy(); // the pillar 'a' distribution
  });

  it("ready with no pillars (tutorial) shows the no-pillar note, not bars", () => {
    setState({ status: "ready", scenarioId: "kredit-macet", data: data({ pillars: [], avg_score: null }) });
    panel();
    expect(screen.getByText("Skenario ini tidak memiliki skor pilar.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("ready zero-session shows the no-sessions note (distinct from tutorial/not-found)", () => {
    setState({ status: "ready", scenarioId: "kredit-macet", data: data({ attempts: 0, pillars: [] }) });
    panel();
    expect(screen.getByText("Belum ada sesi untuk skenario ini.")).toBeTruthy();
  });
});
