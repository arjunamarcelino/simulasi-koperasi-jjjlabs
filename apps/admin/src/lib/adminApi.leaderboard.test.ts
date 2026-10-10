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

import {
  captureLeaderboardSnapshot,
  deleteLeaderboardSeason,
  fetchLeaderboardOverview,
} from "./adminApi";

function resp(status: number, body?: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

const HEADER = {
  id: "s2",
  season_number: 2,
  label: "Awarding Day",
  captured_at: "2026-10-09T04:00:00Z",
  entry_count: 2,
};
const OVERVIEW = {
  seasons: [HEADER, { ...HEADER, id: "s1", season_number: 1, label: null, entry_count: 0 }],
  selected: {
    ...HEADER,
    entries: [
      { rank: 1, display_name: "Budi", xp: 1500, level: 6 },
      { rank: 2, display_name: "Anggota", xp: 900, level: 4 },
    ],
  },
};
// No-season case: selected is null.
const EMPTY_OVERVIEW = { seasons: [], selected: null };
const CAPTURE = { season_id: "s3", season_number: 3, captured_at: "2026-10-09T05:00:00Z", entry_count: 42 };
const DELETE_OK = { deleted: true, season_number: 3 };

beforeEach(() => {
  h.supabaseNull = false;
  h.getSession.mockReset();
  h.refreshSession.mockReset();
  h.fetch.mockReset();
  h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchLeaderboardOverview", () => {
  it("ok on 200 with a fully valid body", async () => {
    h.fetch.mockResolvedValue(resp(200, OVERVIEW));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "ok", data: OVERVIEW });
  });

  it("accepts the no-season body (selected: null, empty seasons)", async () => {
    h.fetch.mockResolvedValue(resp(200, EMPTY_OVERVIEW));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "ok", data: EMPTY_OVERVIEW });
  });

  it("no season id → no query string", async () => {
    h.fetch.mockResolvedValue(resp(200, OVERVIEW));
    await fetchLeaderboardOverview();
    expect(h.fetch.mock.calls[0]?.[0]).toBe("http://localhost:8000/admin/leaderboard");
  });

  it("encodes the season id into the query", async () => {
    h.fetch.mockResolvedValue(resp(200, OVERVIEW));
    await fetchLeaderboardOverview("s 2/../x");
    expect(h.fetch.mock.calls[0]?.[0]).toBe(
      "http://localhost:8000/admin/leaderboard?season_id=s%202%2F..%2Fx",
    );
  });

  it("403 → notAuthorized, 401(after refresh fail) → unauthenticated, 503 → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(403));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "notAuthorized" });
    h.refreshSession.mockResolvedValue({ data: { session: null } });
    h.fetch.mockResolvedValue(resp(401));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "unauthenticated" });
    h.fetch.mockResolvedValue(resp(503));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "serviceUnavailable" });
  });

  it("404 is NOT a distinct outcome here → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(404));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "serviceUnavailable" });
  });

  it("401 → refresh ONCE → retry → ok", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "fresh" } } });
    h.fetch.mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200, OVERVIEW));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "ok", data: OVERVIEW });
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  // --- guard rejects malformed / duplicate-rank / oversized 200 bodies → fault, not data ---
  const BAD: Array<[string, unknown]> = [
    ["missing selected key", { seasons: [] }],
    ["season header missing id", { seasons: [{ ...HEADER, id: 123 }], selected: null }],
    ["null label accepted but negative entry_count rejected", { seasons: [{ ...HEADER, entry_count: -1 }], selected: null }],
    ["float season_number", { seasons: [{ ...HEADER, season_number: 2.5 }], selected: null }],
    ["entry negative xp", { ...OVERVIEW, selected: { ...HEADER, entries: [{ rank: 1, display_name: "x", xp: -1, level: 1 }] } }],
    ["duplicate ranks", { ...OVERVIEW, selected: { ...HEADER, entries: [
      { rank: 1, display_name: "a", xp: 10, level: 1 },
      { rank: 1, display_name: "b", xp: 5, level: 1 },
    ] } }],
    ["entries not array", { ...OVERVIEW, selected: { ...HEADER, entries: {} } }],
    ["oversized entries (>100)", { ...OVERVIEW, selected: { ...HEADER, entries: Array.from({ length: 101 }, (_, i) => ({ rank: i + 1, display_name: "x", xp: 1, level: 1 })) } }],
    ["oversized seasons (>50)", { seasons: Array.from({ length: 51 }, (_, i) => ({ ...HEADER, id: `s${i}`, season_number: i + 1 })), selected: null }],
    ["label wrong type", { seasons: [{ ...HEADER, label: 5 }], selected: null }],
  ];
  it.each(BAD)("200 with %s → serviceUnavailable (guard rejects)", async (_label, body) => {
    h.fetch.mockResolvedValue(resp(200, body));
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "serviceUnavailable" });
  });

  it("null client → serviceUnavailable with NO network", async () => {
    h.supabaseNull = true;
    expect(await fetchLeaderboardOverview()).toEqual({ kind: "serviceUnavailable" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("captureLeaderboardSnapshot", () => {
  it("POSTs with a string JSON body and ok on 200", async () => {
    h.fetch.mockResolvedValue(resp(200, CAPTURE));
    expect(await captureLeaderboardSnapshot("Awarding Day")).toEqual({ kind: "ok", data: CAPTURE });
    const init = h.fetch.mock.calls[0]?.[1];
    expect(init.method).toBe("POST");
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body)).toEqual({ label: "Awarding Day" });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("null label → empty-object body", async () => {
    h.fetch.mockResolvedValue(resp(200, CAPTURE));
    await captureLeaderboardSnapshot(null);
    expect(JSON.parse(h.fetch.mock.calls[0]?.[1].body)).toEqual({});
  });

  it("401 resend re-applies POST + string body (safe: auth precedes DB)", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "fresh" } } });
    h.fetch.mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200, CAPTURE));
    expect(await captureLeaderboardSnapshot(null)).toEqual({ kind: "ok", data: CAPTURE });
    expect(h.fetch.mock.calls[1]?.[1].method).toBe("POST");
    expect(typeof h.fetch.mock.calls[1]?.[1].body).toBe("string");
  });

  it("403 → notAuthorized; 503 → serviceUnavailable; malformed 200 → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(403));
    expect(await captureLeaderboardSnapshot(null)).toEqual({ kind: "notAuthorized" });
    h.fetch.mockResolvedValue(resp(503));
    expect(await captureLeaderboardSnapshot(null)).toEqual({ kind: "serviceUnavailable" });
    h.fetch.mockResolvedValue(resp(200, { season_id: "s3", season_number: -1, captured_at: "t", entry_count: 1 }));
    expect(await captureLeaderboardSnapshot(null)).toEqual({ kind: "serviceUnavailable" });
  });

  it("has NO notFound outcome (404 → serviceUnavailable)", async () => {
    h.fetch.mockResolvedValue(resp(404));
    expect(await captureLeaderboardSnapshot(null)).toEqual({ kind: "serviceUnavailable" });
  });
});

describe("deleteLeaderboardSeason", () => {
  it("DELETEs the encoded path and ok on 200", async () => {
    h.fetch.mockResolvedValue(resp(200, DELETE_OK));
    expect(await deleteLeaderboardSeason("s3")).toEqual({ kind: "ok", data: DELETE_OK });
    expect(h.fetch.mock.calls[0]?.[0]).toBe("http://localhost:8000/admin/leaderboard/seasons/s3");
    expect(h.fetch.mock.calls[0]?.[1].method).toBe("DELETE");
  });

  it("404 → distinct notFound (not serviceUnavailable)", async () => {
    h.fetch.mockResolvedValue(resp(404, { detail: "season_not_found" }));
    expect(await deleteLeaderboardSeason("gone")).toEqual({ kind: "notFound" });
  });

  it("403 → notAuthorized; 503 → serviceUnavailable; malformed 200 → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(403));
    expect(await deleteLeaderboardSeason("s3")).toEqual({ kind: "notAuthorized" });
    h.fetch.mockResolvedValue(resp(503));
    expect(await deleteLeaderboardSeason("s3")).toEqual({ kind: "serviceUnavailable" });
    h.fetch.mockResolvedValue(resp(200, { deleted: "yes", season_number: null }));
    expect(await deleteLeaderboardSeason("s3")).toEqual({ kind: "serviceUnavailable" });
  });

  it("accepts {deleted:false, season_number:null} as a valid 200 body", async () => {
    h.fetch.mockResolvedValue(resp(200, { deleted: false, season_number: null }));
    expect(await deleteLeaderboardSeason("s3")).toEqual({
      kind: "ok",
      data: { deleted: false, season_number: null },
    });
  });
});
