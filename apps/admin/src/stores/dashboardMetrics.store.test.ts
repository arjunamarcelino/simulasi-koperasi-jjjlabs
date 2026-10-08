import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMetrics } from "../lib/adminApi";

const h = vi.hoisted(() => ({
  fetchMetrics: vi.fn(),
  retry: vi.fn(),
  gateStatus: "authorized" as string,
}));

vi.mock("../lib/adminApi", () => ({ fetchMetrics: h.fetchMetrics }));
vi.mock("./adminAuth.store", () => ({
  adminAuthStore: {
    getState: () => ({ retry: h.retry, gate: { status: h.gateStatus } }),
  },
}));

import {
  dashboardMetricsStore,
  __resetDashboardMetricsForTest,
} from "./dashboardMetrics.store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => dashboardMetricsStore.getState().state;
const DATA = { generated_at: "t", users: {}, sessions: {}, per_scenario: [] } as unknown as AdminMetrics;

beforeEach(() => {
  h.fetchMetrics.mockReset();
  h.retry.mockReset();
  h.retry.mockResolvedValue(undefined);
  h.gateStatus = "authorized";
  __resetDashboardMetricsForTest();
});

describe("dashboardMetrics store", () => {
  it("load → ok → ready{data}", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "ok", data: DATA });
    dashboardMetricsStore.getState().load("u1");
    await flush();
    expect(state()).toEqual({ status: "ready", data: DATA });
  });

  it("serviceUnavailable → error (retryable)", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "serviceUnavailable" });
    dashboardMetricsStore.getState().load("u1");
    await flush();
    expect(state()).toEqual({ status: "error" });
  });

  it("authUnavailable → unavailable (terminal)", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "authUnavailable" });
    dashboardMetricsStore.getState().load("u1");
    await flush();
    expect(state()).toEqual({ status: "unavailable" });
  });

  it("load is once-per-userId (StrictMode-safe)", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "ok", data: DATA });
    dashboardMetricsStore.getState().load("u1");
    dashboardMetricsStore.getState().load("u1");
    await flush();
    expect(h.fetchMetrics).toHaveBeenCalledTimes(1);
  });

  it("retry() refetches /admin/metrics", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "serviceUnavailable" });
    dashboardMetricsStore.getState().load("u1");
    await flush();
    dashboardMetricsStore.getState().retry();
    await flush();
    expect(h.fetchMetrics).toHaveBeenCalledTimes(2);
  });

  it("auth-loss bridges to the gate once; when the gate flips it stays passive (authLost)", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "unauthenticated" });
    // the gate re-probe flips away from authorized (→ App unmounts us)
    h.retry.mockImplementation(async () => {
      h.gateStatus = "unauthenticated";
    });
    dashboardMetricsStore.getState().load("u1");
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "authLost" });
  });

  it("disagreement (gate re-affirms authorized) → error, and does NOT loop", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "notAuthorized" });
    h.retry.mockResolvedValue(undefined); // gate stays "authorized"
    dashboardMetricsStore.getState().load("u1");
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1); // bridged once
    expect(state()).toEqual({ status: "error" }); // fell to manual retry, no spinner-lock

    // A manual retry that hits the SAME auth-loss must NOT bridge again (one-shot latch).
    dashboardMetricsStore.getState().retry();
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "error" });
  });

  it("dispose resets so a remount refetches", async () => {
    h.fetchMetrics.mockResolvedValue({ kind: "ok", data: DATA });
    dashboardMetricsStore.getState().load("u1");
    await flush();
    dashboardMetricsStore.getState().dispose();
    expect(state()).toEqual({ status: "loading" });
    dashboardMetricsStore.getState().load("u1"); // same id, but dispose cleared activeUserId
    await flush();
    expect(h.fetchMetrics).toHaveBeenCalledTimes(2);
  });
});
