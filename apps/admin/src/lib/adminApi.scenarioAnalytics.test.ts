import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  supabaseNull: false,
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../config/env", () => ({
  ENV: {
    adminApiEndpoint: "http://localhost:8000",
    supabaseUrl: "http://x",
    supabaseAnonKey: "y",
    turnstileSiteKey: undefined,
  },
}));

vi.mock("./supabase", () => ({
  get supabase() {
    return h.supabaseNull
      ? null
      : { auth: { getSession: h.getSession, refreshSession: h.refreshSession } };
  },
}));

import { fetchScenarioAnalytics } from "./adminApi";

function resp(status: number, body?: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

const VALID = {
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
};

// Tutorial-shaped: empty pillars, null avg, null dropoff — must pass the guard.
const TUTORIAL = {
  ...VALID,
  scenario_id: "tutorial-koperasi-konsumen",
  title: "Tutorial",
  avg_score: null,
  pillars: [],
};

beforeEach(() => {
  h.supabaseNull = false;
  h.getSession.mockReset();
  h.refreshSession.mockReset();
  h.fetch.mockReset();
  h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchScenarioAnalytics", () => {
  it("ok on 200 with a fully valid body", async () => {
    h.fetch.mockResolvedValue(resp(200, VALID));
    expect(await fetchScenarioAnalytics("kredit-macet")).toEqual({ kind: "ok", data: VALID });
  });

  it("accepts the tutorial shape (empty pillars, null avg/dropoff)", async () => {
    h.fetch.mockResolvedValue(resp(200, TUTORIAL));
    expect(await fetchScenarioAnalytics("tutorial-koperasi-konsumen")).toEqual({
      kind: "ok",
      data: TUTORIAL,
    });
  });

  it("encodes the scenario id into the path", async () => {
    h.fetch.mockResolvedValue(resp(200, VALID));
    await fetchScenarioAnalytics("kredit macet/../x");
    expect(h.fetch.mock.calls[0]?.[0]).toBe(
      "http://localhost:8000/admin/scenarios/kredit%20macet%2F..%2Fx/analytics",
    );
  });

  it("404 → notFound (distinct terminal, not serviceUnavailable)", async () => {
    h.fetch.mockResolvedValue(resp(404, { detail: "unknown_scenario" }));
    expect(await fetchScenarioAnalytics("nope")).toEqual({ kind: "notFound" });
  });

  it("403 → notAuthorized", async () => {
    h.fetch.mockResolvedValue(resp(403, { detail: "forbidden" }));
    expect(await fetchScenarioAnalytics("kredit-macet")).toEqual({ kind: "notAuthorized" });
  });

  it("503 → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(503));
    expect(await fetchScenarioAnalytics("kredit-macet")).toEqual({ kind: "serviceUnavailable" });
  });

  it("401 → refresh ONCE → retry → ok", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "fresh" } } });
    h.fetch.mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200, VALID));
    expect(await fetchScenarioAnalytics("kredit-macet")).toEqual({ kind: "ok", data: VALID });
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  // --- the guard rejects semantically-invalid-but-well-formed 200 bodies → fault, not data ---
  const BAD: Array<[string, unknown]> = [
    ["negative count", { ...VALID, attempts: -1 }],
    ["float count", { ...VALID, outcome: { ...VALID.outcome, completed: 8.5 } }],
    ["buckets length 4", { ...VALID, pillars: [{ key: "a", count: 1, avg: 10, buckets: [1, 0, 0, 0] }] }],
    ["non-finite avg", { ...VALID, avg_score: Number.NaN }],
    ["by_trigger not object", { ...VALID, outcome: { ...VALID.outcome, by_trigger: [1, 2] } }],
    ["non-null dropoff (Core must be null)", { ...VALID, dropoff: { kind: "phase", stages: [], plays: 0 } }],
    ["pillars not array", { ...VALID, pillars: {} }],
  ];
  it.each(BAD)("200 with %s → serviceUnavailable (guard rejects)", async (_label, body) => {
    h.fetch.mockResolvedValue(resp(200, body));
    expect(await fetchScenarioAnalytics("kredit-macet")).toEqual({ kind: "serviceUnavailable" });
  });

  it("null client → serviceUnavailable with NO network", async () => {
    h.supabaseNull = true;
    expect(await fetchScenarioAnalytics("kredit-macet")).toEqual({ kind: "serviceUnavailable" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
