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

import { probeAdmin } from "./adminApi";

function resp(status: number, body?: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  h.supabaseNull = false;
  h.getSession.mockReset();
  h.refreshSession.mockReset();
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("probeAdmin", () => {
  it("authorized on 200 with a valid body (gates on status, reads user_id)", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockResolvedValue(resp(200, { user_id: "u1", is_admin: true }));
    expect(await probeAdmin()).toEqual({ kind: "authorized", userId: "u1" });
  });

  it("notAuthorized on 403", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockResolvedValue(resp(403, { detail: "forbidden" }));
    expect(await probeAdmin()).toEqual({ kind: "notAuthorized" });
  });

  it("unauthenticated with NO network when there is no session", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    expect(await probeAdmin()).toEqual({ kind: "unauthenticated" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("401 → refresh ONCE → retry → authorized", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "fresh" } } });
    h.fetch
      .mockResolvedValueOnce(resp(401))
      .mockResolvedValueOnce(resp(200, { user_id: "u2" }));
    expect(await probeAdmin()).toEqual({ kind: "authorized", userId: "u2" });
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("401 then refresh yields no token → unauthenticated", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    h.refreshSession.mockResolvedValue({ data: { session: null } });
    h.fetch.mockResolvedValueOnce(resp(401));
    expect(await probeAdmin()).toEqual({ kind: "unauthenticated" });
  });

  it("503 and 500 → serviceUnavailable", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockResolvedValue(resp(503));
    expect(await probeAdmin()).toEqual({ kind: "serviceUnavailable" });
    h.fetch.mockResolvedValue(resp(500));
    expect(await probeAdmin()).toEqual({ kind: "serviceUnavailable" });
  });

  it("200 with a malformed body → serviceUnavailable (fault, not authorized)", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockResolvedValue(resp(200, { nope: 1 }));
    expect(await probeAdmin()).toEqual({ kind: "serviceUnavailable" });
  });

  it("fetch throwing (network / timeout / abort) → serviceUnavailable", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    h.fetch.mockRejectedValue(new Error("boom"));
    expect(await probeAdmin()).toEqual({ kind: "serviceUnavailable" });
  });

  it("authUnavailable with NO network when the client is null", async () => {
    h.supabaseNull = true;
    expect(await probeAdmin()).toEqual({ kind: "authUnavailable" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
