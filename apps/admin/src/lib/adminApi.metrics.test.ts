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

import { fetchMetrics } from "./adminApi";

function resp(status: number, body?: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

const VALID = {
  generated_at: "2026-10-09T04:00:00Z",
  users: { active_30d: 2, total_registered: 3, new_7d: 3 },
  sessions: {
    total: 10,
    completion_rate: 0.9,
    ending_split: { good: 0.7, neutral: 0.2, bad: 0.1 },
    avg_score: 55,
  },
  per_scenario: [
    {
      scenario_id: "keanggotaan-fiktif",
      title: "Keanggotaan Fiktif",
      sessions: 0,
      completion_rate: null,
      ending_split: null,
      avg_score: null,
    },
  ],
};

beforeEach(() => {
  h.supabaseNull = false;
  h.getSession.mockReset();
  h.refreshSession.mockReset();
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchMetrics", () => {
  it("ok on 200 with a fully valid body (nulls allowed on rates)", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockResolvedValue(resp(200, VALID));
    const out = await fetchMetrics();
    expect(out).toEqual({ kind: "ok", data: VALID });
  });

  it("200 with a malformed leaf (completion_rate a string) → serviceUnavailable, not ok", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    const bad = { ...VALID, sessions: { ...VALID.sessions, completion_rate: "high" } };
    h.fetch.mockResolvedValue(resp(200, bad));
    expect(await fetchMetrics()).toEqual({ kind: "serviceUnavailable" });
  });

  it("200 with a malformed per_scenario element → serviceUnavailable", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    const bad = { ...VALID, per_scenario: [{ scenario_id: "x" }] };
    h.fetch.mockResolvedValue(resp(200, bad));
    expect(await fetchMetrics()).toEqual({ kind: "serviceUnavailable" });
  });

  it("403 → notAuthorized", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockResolvedValue(resp(403, { detail: "forbidden" }));
    expect(await fetchMetrics()).toEqual({ kind: "notAuthorized" });
  });

  it("401 → refresh ONCE → retry → ok", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "fresh" } } });
    h.fetch.mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200, VALID));
    expect(await fetchMetrics()).toEqual({ kind: "ok", data: VALID });
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("404 (route gone after rollback) → serviceUnavailable (switch default)", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockResolvedValue(resp(404));
    expect(await fetchMetrics()).toEqual({ kind: "serviceUnavailable" });
  });

  it("null client → serviceUnavailable with NO network (collapsed; unreachable once gated)", async () => {
    h.supabaseNull = true;
    expect(await fetchMetrics()).toEqual({ kind: "serviceUnavailable" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
