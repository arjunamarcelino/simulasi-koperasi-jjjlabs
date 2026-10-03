import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthError } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({
  supabaseNull: false,
  authCallback: null as null | ((event: string, session: unknown) => void),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
  getSession: vi.fn(),
  probeAdmin: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return h.supabaseNull
      ? null
      : {
          auth: {
            onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
              h.authCallback = cb;
              return { data: { subscription: { unsubscribe: h.unsubscribe } } };
            },
            signInWithPassword: h.signInWithPassword,
            signOut: h.signOut,
            refreshSession: h.refreshSession,
            getSession: h.getSession,
          },
        };
  },
}));

vi.mock("../lib/adminApi", () => ({ probeAdmin: h.probeAdmin }));

import {
  adminAuthStore,
  initAdminAuth,
  __resetAdminAuthForTest,
} from "./adminAuth.store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const gate = () => adminAuthStore.getState().gate;
const emit = (event: string, token: string | null) =>
  h.authCallback?.(event, token ? { access_token: token } : null);

beforeEach(() => {
  h.supabaseNull = false;
  h.authCallback = null;
  h.signInWithPassword.mockReset();
  h.signOut.mockReset();
  h.refreshSession.mockReset();
  h.getSession.mockReset();
  h.probeAdmin.mockReset();
  __resetAdminAuthForTest();
});
afterEach(() => __resetAdminAuthForTest());

describe("adminAuth store", () => {
  it("null client → terminal authUnavailable, never subscribes", () => {
    h.supabaseNull = true;
    initAdminAuth();
    expect(gate()).toEqual({ status: "authUnavailable" });
    expect(h.authCallback).toBeNull();
  });

  it("INITIAL_SESSION with a session + admin probe → authorized", async () => {
    h.probeAdmin.mockResolvedValue({ kind: "authorized", userId: "u1" });
    initAdminAuth();
    emit("INITIAL_SESSION", "t1");
    await flush();
    expect(gate()).toEqual({ status: "authorized", userId: "u1" });
  });

  it("probe 403 → notAuthorized (session kept)", async () => {
    h.probeAdmin.mockResolvedValue({ kind: "notAuthorized" });
    initAdminAuth();
    emit("SIGNED_IN", "t1");
    await flush();
    expect(gate()).toEqual({ status: "notAuthorized", refreshing: false });
  });

  it("SIGNED_OUT → unauthenticated, never probes or re-anons", async () => {
    initAdminAuth();
    emit("SIGNED_OUT", null);
    await flush();
    expect(gate()).toEqual({ status: "unauthenticated", loginError: null, signingIn: false });
    expect(h.probeAdmin).not.toHaveBeenCalled();
  });

  it("dedups INITIAL_SESSION + SIGNED_IN on the same token to ONE probe", async () => {
    h.probeAdmin.mockResolvedValue({ kind: "authorized", userId: "u1" });
    initAdminAuth();
    emit("INITIAL_SESSION", "t1");
    emit("SIGNED_IN", "t1");
    await flush();
    expect(h.probeAdmin).toHaveBeenCalledTimes(1);
  });

  it("TOKEN_REFRESHED with a NEW token re-probes (demotion reflected)", async () => {
    h.probeAdmin.mockResolvedValueOnce({ kind: "authorized", userId: "u1" });
    initAdminAuth();
    emit("SIGNED_IN", "t1");
    await flush();
    expect(gate()).toEqual({ status: "authorized", userId: "u1" });

    h.probeAdmin.mockResolvedValueOnce({ kind: "notAuthorized" });
    emit("TOKEN_REFRESHED", "t2");
    await flush();
    expect(gate()).toEqual({ status: "notAuthorized", refreshing: false });
    expect(h.probeAdmin).toHaveBeenCalledTimes(2);
  });

  it("signIn error surfaces a typed loginError, stays unauthenticated", async () => {
    const error = { code: "invalid_credentials", message: "x", name: "AuthApiError", status: 400 };
    h.signInWithPassword.mockResolvedValue({ data: {}, error: error as unknown as AuthError });
    initAdminAuth();
    await adminAuthStore.getState().signIn("a@b.c", "pw");
    expect(gate()).toEqual({
      status: "unauthenticated",
      loginError: "invalid_credentials",
      signingIn: false,
    });
  });

  it("signIn passes captchaToken only when provided", async () => {
    h.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    initAdminAuth();
    await adminAuthStore.getState().signIn("a@b.c", "pw", "cap-token");
    expect(h.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.c",
      password: "pw",
      options: { captchaToken: "cap-token" },
    });
    await adminAuthStore.getState().signIn("a@b.c", "pw");
    expect(h.signInWithPassword).toHaveBeenLastCalledWith({ email: "a@b.c", password: "pw" });
  });
});
