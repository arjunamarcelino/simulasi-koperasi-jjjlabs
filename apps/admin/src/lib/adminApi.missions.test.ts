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

import { listMissions, rotateMissionCode } from "./adminApi";

function resp(status: number, body?: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

const ROW = {
  code: "kunjungi-kdmp",
  title: "Kunjungi KDMP",
  redeem_code: "KDMP2026",
  redeem_code_updated_at: null,
  redeem_code_updated_by: null,
};
const LIST_OK = { ok: true, rows: [ROW, { ...ROW, code: "impact-umkm", redeem_code: "UMKM2026" }] };

beforeEach(() => {
  h.supabaseNull = false;
  h.getSession.mockReset();
  h.refreshSession.mockReset();
  h.fetch.mockReset();
  h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("listMissions", () => {
  it("ok on a valid 200", async () => {
    h.fetch.mockResolvedValue(resp(200, LIST_OK));
    const out = await listMissions();
    expect(out).toEqual({ kind: "ok", data: LIST_OK.rows });
  });

  it("malformed 200 (missing redeem_code) → serviceUnavailable", async () => {
    const bad = { ok: true, rows: [{ code: "x", title: "T", redeem_code_updated_at: null, redeem_code_updated_by: null }] };
    h.fetch.mockResolvedValue(resp(200, bad));
    expect((await listMissions()).kind).toBe("serviceUnavailable");
  });

  it("non-array rows → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(200, { ok: true, rows: "nope" }));
    expect((await listMissions()).kind).toBe("serviceUnavailable");
  });

  it("bad audit type (number) → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(200, { ok: true, rows: [{ ...ROW, redeem_code_updated_at: 123 }] }));
    expect((await listMissions()).kind).toBe("serviceUnavailable");
  });

  it("403 → notAuthorized, 401 → unauthenticated, 503 → serviceUnavailable", async () => {
    h.fetch.mockResolvedValueOnce(resp(403));
    expect((await listMissions()).kind).toBe("notAuthorized");
    h.refreshSession.mockResolvedValue({ data: { session: null } });
    h.fetch.mockResolvedValueOnce(resp(401)); // 401 then refresh yields no token → unauthenticated
    expect((await listMissions()).kind).toBe("unauthenticated");
    h.fetch.mockResolvedValueOnce(resp(503));
    expect((await listMissions()).kind).toBe("serviceUnavailable");
  });
});

describe("rotateMissionCode", () => {
  it("ok on a valid 200, POSTs {redeem_code} to the code path", async () => {
    h.fetch.mockResolvedValue(resp(200, { ...ROW, redeem_code: "NEW2026" }));
    const out = await rotateMissionCode("kunjungi-kdmp", "NEW2026");
    expect(out).toEqual({ kind: "ok", data: { ...ROW, redeem_code: "NEW2026" } });
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:8000/admin/missions/kunjungi-kdmp");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ redeem_code: "NEW2026" });
  });

  it("encodes the code in the path", async () => {
    h.fetch.mockResolvedValue(resp(404));
    await rotateMissionCode("a/b code", "X");
    expect(h.fetch.mock.calls[0]![0]).toBe("http://localhost:8000/admin/missions/a%2Fb%20code");
  });

  it("422 → rejected with reason", async () => {
    h.fetch.mockResolvedValue(resp(422, { detail: "too_long" }));
    expect(await rotateMissionCode("c", "x")).toEqual({ kind: "rejected", reason: "too_long" });
  });

  it("404 → notFound; 403 → notAuthorized", async () => {
    h.fetch.mockResolvedValueOnce(resp(404));
    expect((await rotateMissionCode("c", "x")).kind).toBe("notFound");
    h.fetch.mockResolvedValueOnce(resp(403));
    expect((await rotateMissionCode("c", "x")).kind).toBe("notAuthorized");
  });

  it("an unexpected 409 degrades to serviceUnavailable (no CAS here)", async () => {
    h.fetch.mockResolvedValue(resp(409, { detail: "whatever" }));
    expect((await rotateMissionCode("c", "x")).kind).toBe("serviceUnavailable");
  });

  it("malformed 200 → serviceUnavailable", async () => {
    h.fetch.mockResolvedValue(resp(200, { nope: 1 }));
    expect((await rotateMissionCode("c", "x")).kind).toBe("serviceUnavailable");
  });
});
