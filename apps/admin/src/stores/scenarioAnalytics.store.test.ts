import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioAnalytics } from "../lib/adminApi";

const h = vi.hoisted(() => ({
  fetchScenarioAnalytics: vi.fn(),
  retry: vi.fn(),
  gateStatus: "authorized" as string,
}));

vi.mock("../lib/adminApi", () => ({ fetchScenarioAnalytics: h.fetchScenarioAnalytics }));
vi.mock("./adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: h.retry, gate: { status: h.gateStatus } }) },
}));

import {
  scenarioAnalyticsStore,
  __resetScenarioAnalyticsForTest,
} from "./scenarioAnalytics.store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => scenarioAnalyticsStore.getState().state;
const DATA = { scenario_id: "kredit-macet", pillars: [] } as unknown as ScenarioAnalytics;

beforeEach(() => {
  h.fetchScenarioAnalytics.mockReset();
  h.retry.mockReset();
  h.retry.mockResolvedValue(undefined);
  h.gateStatus = "authorized";
  __resetScenarioAnalyticsForTest();
});

describe("scenarioAnalytics store", () => {
  it("starts idle", () => {
    expect(state()).toEqual({ status: "idle" });
  });

  it("open → ok → ready{scenarioId,data}", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "ok", data: DATA });
    scenarioAnalyticsStore.getState().open("kredit-macet");
    await flush();
    expect(state()).toEqual({ status: "ready", scenarioId: "kredit-macet", data: DATA });
  });

  it("serviceUnavailable → error (retryable, carries scenarioId)", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "serviceUnavailable" });
    scenarioAnalyticsStore.getState().open("kredit-macet");
    await flush();
    expect(state()).toEqual({ status: "error", scenarioId: "kredit-macet" });
  });

  it("404 → notFound (no bridge)", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "notFound" });
    scenarioAnalyticsStore.getState().open("nope");
    await flush();
    expect(state()).toEqual({ status: "notFound", scenarioId: "nope" });
    expect(h.retry).not.toHaveBeenCalled();
  });

  it("open(sameId) again toggles the panel closed (idle)", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "ok", data: DATA });
    const s = scenarioAnalyticsStore.getState();
    s.open("kredit-macet");
    await flush();
    s.open("kredit-macet"); // same id → collapse
    expect(state()).toEqual({ status: "idle" });
  });

  it("reopening a scenario refetches (no stale cache)", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "ok", data: DATA });
    const s = scenarioAnalyticsStore.getState();
    s.open("kredit-macet");
    await flush();
    s.close();
    s.open("kredit-macet");
    await flush();
    expect(h.fetchScenarioAnalytics).toHaveBeenCalledTimes(2);
  });

  it("rapid open(a)→open(b): the stale a result is dropped, b wins", async () => {
    const data_b = { scenario_id: "b", pillars: [] } as unknown as ScenarioAnalytics;
    h.fetchScenarioAnalytics
      .mockResolvedValueOnce({ kind: "ok", data: DATA }) // a (superseded)
      .mockResolvedValueOnce({ kind: "ok", data: data_b }); // b (wins)
    const s = scenarioAnalyticsStore.getState();
    s.open("a");
    s.open("b");
    await flush();
    expect(state()).toEqual({ status: "ready", scenarioId: "b", data: data_b });
  });

  it("close() aborts + resets to idle", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "ok", data: DATA });
    const s = scenarioAnalyticsStore.getState();
    s.open("kredit-macet");
    await flush();
    s.close();
    expect(state()).toEqual({ status: "idle" });
  });

  it("retry() refetches the current scenario", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "serviceUnavailable" });
    const s = scenarioAnalyticsStore.getState();
    s.open("kredit-macet");
    await flush();
    s.retry();
    await flush();
    expect(h.fetchScenarioAnalytics).toHaveBeenCalledTimes(2);
  });

  it("auth-loss bridges to the gate once; stays passive (authLost) when the gate flips away", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "unauthenticated" });
    h.retry.mockImplementation(async () => {
      h.gateStatus = "unauthenticated"; // gate flips → App unmounts us
    });
    scenarioAnalyticsStore.getState().open("kredit-macet");
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "authLost", scenarioId: "kredit-macet" });
  });

  it("disagreement (gate re-affirms authorized) → error, and does NOT loop", async () => {
    h.fetchScenarioAnalytics.mockResolvedValue({ kind: "notAuthorized" });
    h.retry.mockResolvedValue(undefined); // gate stays authorized
    const s = scenarioAnalyticsStore.getState();
    s.open("kredit-macet");
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "error", scenarioId: "kredit-macet" });

    // retry hits the same auth-loss → must NOT bridge again (one-shot latch).
    s.retry();
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
  });
});
