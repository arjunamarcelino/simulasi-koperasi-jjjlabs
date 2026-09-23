import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

/**
 * Narrow, hoisted mock port for the Supabase client. The vi.mock factory below and
 * the tests both reference these handles, so a test can drive events (via
 * authCallback) and shape returns (linkIdentity error, profile row, …) per case.
 */
const h = vi.hoisted(() => ({
  supabaseNull: false,
  subscribeCount: 0,
  authCallback: null as null | ((event: string, session: Session | null) => void),
  signInAnonymously: vi.fn(),
  signInWithOAuth: vi.fn(),
  linkIdentity: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  profileSingle: vi.fn(),
  profileUpdateEq: vi.fn(),
  unsubscribe: vi.fn(),
  controllerStop: vi.fn(),
}));

vi.mock("../lib/supabase", () => {
  const client = {
    auth: {
      onAuthStateChange: (cb: (event: string, session: Session | null) => void) => {
        h.subscribeCount += 1;
        h.authCallback = cb;
        return { data: { subscription: { unsubscribe: h.unsubscribe } } };
      },
      signInAnonymously: h.signInAnonymously,
      signInWithOAuth: h.signInWithOAuth,
      linkIdentity: h.linkIdentity,
      signOut: h.signOut,
      getSession: h.getSession,
      refreshSession: h.refreshSession,
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: h.profileSingle }) }),
      update: () => ({ eq: h.profileUpdateEq }),
    }),
  };
  // A live getter, not a baked value: resetModules does not re-run this factory, so
  // the supabaseNull toggle must be read at access time (else it leaks between tests).
  return {
    get supabase() {
      return h.supabaseNull ? null : client;
    },
  };
});

// signOut dynamically imports the session controller to tear down a live room.
vi.mock("../session/controller", () => ({
  sessionController: { stop: h.controllerStop },
}));

function makeSession(id: string, isAnonymous: boolean): Session {
  return {
    access_token: `token-${id}`,
    refresh_token: `refresh-${id}`,
    expires_in: 3600,
    expires_at: 9_999_999_999,
    token_type: "bearer",
    user: {
      id,
      is_anonymous: isAnonymous,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
  } as unknown as Session;
}

/** Memory-backed Storage stub (node env has no sessionStorage). */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** Reset module singletons + mock state, then import a fresh auth.store. */
async function fresh(opts: { supabaseNull?: boolean } = {}) {
  vi.resetModules();
  h.supabaseNull = opts.supabaseNull ?? false;
  h.subscribeCount = 0;
  h.authCallback = null;
  h.signInAnonymously.mockReset().mockResolvedValue({ data: {}, error: null });
  h.signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
  h.linkIdentity.mockReset().mockResolvedValue({ data: {}, error: null });
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  h.refreshSession.mockReset().mockResolvedValue({ data: { session: null } });
  h.profileSingle.mockReset().mockResolvedValue({ data: null, error: null });
  h.profileUpdateEq.mockReset().mockResolvedValue({ error: null });
  h.unsubscribe.mockReset();
  h.controllerStop.mockReset();
  return import("./auth.store");
}

/** Flush microtasks + awaited promises (queueMicrotask-deferred loadProfile). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { origin: "http://localhost:5173", href: "http://localhost:5173/" },
    history: { replaceState: vi.fn() },
  });
  vi.stubGlobal("sessionStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("auth.store bootstrap", () => {
  it("A1: INITIAL_SESSION null → anon sign-in once; ready held until SIGNED_IN → guest", async () => {
    const { authStore, initAuth } = await fresh();
    initAuth();
    h.authCallback!("INITIAL_SESSION", null);
    // Re-anon is deferred (queueMicrotask); ready stays FALSE until a real session.
    expect(authStore.getState().ready).toBe(false);
    await flush();
    expect(h.signInAnonymously).toHaveBeenCalledTimes(1);

    h.authCallback!("SIGNED_IN", makeSession("u1", true));
    expect(authStore.getState().ready).toBe(true);
    expect(authStore.getState().auth.status).toBe("guest");
  });

  it("A2: INITIAL_SESSION with a permanent session → no anon sign-in; authenticated", async () => {
    const { authStore, initAuth } = await fresh();
    initAuth();
    h.authCallback!("INITIAL_SESSION", makeSession("u1", false));
    expect(h.signInAnonymously).not.toHaveBeenCalled();
    expect(authStore.getState().auth.status).toBe("authenticated");
  });

  it("A3: USER_UPDATED (linked) → guest → authenticated, same user id", async () => {
    const { authStore, initAuth } = await fresh();
    initAuth();
    h.authCallback!("INITIAL_SESSION", makeSession("u1", true));
    expect(authStore.getState().auth.status).toBe("guest");

    h.authCallback!("USER_UPDATED", makeSession("u1", false));
    expect(authStore.getState().auth.status).toBe("authenticated");
    expect(authStore.getState().auth.user?.id).toBe("u1");
  });

  it("A4: loadProfile sets display_name; setDisplayName updates profiles", async () => {
    const { authStore, initAuth } = await fresh();
    h.profileSingle.mockResolvedValue({ data: { id: "u1", display_name: "Budi" }, error: null });

    initAuth();
    h.authCallback!("INITIAL_SESSION", makeSession("u1", true));
    await flush();
    expect(authStore.getState().auth.profile?.display_name).toBe("Budi");

    await authStore.getState().setDisplayName("Siti");
    expect(h.profileUpdateEq).toHaveBeenCalled();
    expect(authStore.getState().auth.profile?.display_name).toBe("Siti");
  });

  it("E2: double initAuth → onAuthStateChange subscribed once", async () => {
    const { initAuth } = await fresh();
    initAuth();
    initAuth();
    expect(h.subscribeCount).toBe(1);
  });

  it("E4: no INITIAL_SESSION within the timeout → degraded, ready (no infinite splash)", async () => {
    vi.useFakeTimers();
    const { authStore, initAuth } = await fresh();
    initAuth();
    expect(authStore.getState().ready).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(authStore.getState().ready).toBe(true);
    expect(authStore.getState().auth.status).toBe("degraded");
  });
});

describe("auth.store link / signOut / degraded", () => {
  it("N1: linkGoogle collision → { ok:false, reason:'collision' }", async () => {
    const { authStore } = await fresh();
    h.linkIdentity.mockResolvedValue({
      data: {},
      error: { code: "identity_already_exists", message: "Identity already linked" },
    });
    const result = await authStore.getState().linkGoogle();
    expect(result).toEqual({ ok: false, reason: "collision" });
  });

  it("N2: linkGoogle other error → { ok:false, reason:'error' }", async () => {
    const { authStore } = await fresh();
    h.linkIdentity.mockResolvedValue({ data: {}, error: { code: "unexpected", message: "boom" } });
    const result = await authStore.getState().linkGoogle();
    expect(result).toEqual({ ok: false, reason: "error" });
  });

  it("N4: no Supabase env → initAuth sets degraded + ready, no throw", async () => {
    const { authStore, initAuth } = await fresh({ supabaseNull: true });
    expect(() => initAuth()).not.toThrow();
    expect(authStore.getState().ready).toBe(true);
    expect(authStore.getState().auth.status).toBe("degraded");
    expect(h.signInAnonymously).not.toHaveBeenCalled();
  });

  it("E1: signOut → controller.stop then re-anon; ends at guest", async () => {
    const { authStore, initAuth } = await fresh();
    initAuth();
    h.authCallback!("INITIAL_SESSION", makeSession("u1", true));

    await authStore.getState().signOut();
    expect(h.controllerStop).toHaveBeenCalledTimes(1);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });

    // The listener re-anons on SIGNED_OUT, then a fresh guest signs in.
    h.authCallback!("SIGNED_OUT", null);
    await flush(); // re-anon is deferred (queueMicrotask)
    expect(h.signInAnonymously).toHaveBeenCalled();
    h.authCallback!("SIGNED_IN", makeSession("u2", true));
    expect(authStore.getState().auth.status).toBe("guest");
  });

  it("E3: stale loadProfile (id changed during await) is dropped", async () => {
    const { authStore, initAuth } = await fresh();
    let resolveU1!: (value: { data: unknown; error: null }) => void;
    // u1's profile parks on a pending promise; u2's resolves immediately with fresh data.
    h.profileSingle
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveU1 = res;
        }),
      )
      .mockResolvedValue({ data: { id: "u2", display_name: "Fresh" }, error: null });

    initAuth();
    // Guest u1 → loadProfile(u1) starts and parks on the pending single().
    h.authCallback!("INITIAL_SESSION", makeSession("u1", true));
    await flush();
    // A newer auth wins BEFORE u1's profile resolves; loadProfile(u2) sets "Fresh".
    h.authCallback!("SIGNED_IN", makeSession("u2", true));
    await flush();
    // u1's stale result arrives last — must be dropped (current user is u2).
    resolveU1({ data: { id: "u1", display_name: "Stale" }, error: null });
    await flush();

    expect(authStore.getState().auth.user?.id).toBe("u2");
    expect(authStore.getState().auth.profile?.display_name).toBe("Fresh");
  });
});

describe("authedFetch", () => {
  it("N3: 401 → refresh + retry with a different bearer; 200 returned", async () => {
    await fresh();
    h.getSession.mockResolvedValue({ data: { session: { access_token: "old" } } });
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "new" } } });
    const seen: (string | null)[] = [];
    const fetchMock = vi.fn((_input: unknown, init: RequestInit | undefined) => {
      const auth = new Headers(init?.headers).get("Authorization");
      seen.push(auth);
      return Promise.resolve(new Response(null, { status: auth === "Bearer old" ? 401 : 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { authedFetch } = await import("../lib/authedFetch");
    const res = await authedFetch("http://x/token", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
    expect(res.status).toBe(200);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("N3b: 403 is NOT retried (real authz denial)", async () => {
    await fresh();
    h.getSession.mockResolvedValue({ data: { session: { access_token: "old" } } });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 403 })));
    vi.stubGlobal("fetch", fetchMock);

    const { authedFetch } = await import("../lib/authedFetch");
    const res = await authedFetch("http://x/token");

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.refreshSession).not.toHaveBeenCalled();
  });
});
