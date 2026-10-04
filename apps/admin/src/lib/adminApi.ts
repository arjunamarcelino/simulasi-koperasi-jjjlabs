import { supabase } from "./supabase";
import { ENV } from "../config/env";

/**
 * Total outcome of probing `GET /admin/me`. The store is a pure reducer over this —
 * it never sees a raw Response and never branches on the body's `is_admin` (which is
 * always true in a 200, so it carries no authorization info). Authorization lives in
 * the HTTP STATUS only.
 */
export type ProbeOutcome =
  | { kind: "authorized"; userId: string }
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 (after a single refresh-retry) or no session
  | { kind: "serviceUnavailable" } // 503/500/network/timeout/malformed-200 — all "try again"
  | { kind: "authUnavailable" }; // null client (missing env)

/** Per-probe request timeout: a hung/black-holed backend must not strand the UI
 * (the boot watchdog only covers the pre-login "loading" state). */
const PROBE_TIMEOUT_MS = 10_000;

/** Narrow the 200 body with a real guard — no `as` cast (which `no-explicit-any` rejects). */
function isProbeBody(x: unknown): x is { user_id: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Record<string, unknown>)["user_id"] === "string"
  );
}

/** Shared in-flight refresh so N concurrent 401s trigger one token rotation, not N. */
let refreshInFlight: Promise<string | undefined> | null = null;
function refreshOnce(): Promise<string | undefined> {
  refreshInFlight ??= (async () => {
    try {
      const { data } = await supabase!.auth.refreshSession();
      return data.session?.access_token;
    } catch {
      return undefined;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Absolute URL of GET /admin/me, or null when the endpoint env is unset/invalid. */
function adminMeUrl(): string | null {
  const base = ENV.adminApiEndpoint;
  if (!base?.trim()) return null;
  try {
    return new URL("/admin/me", new URL(base).origin).href;
  } catch {
    return null;
  }
}

async function classify(res: Response): Promise<ProbeOutcome> {
  switch (res.status) {
    case 200: {
      const body: unknown = await res.json().catch(() => null);
      return isProbeBody(body)
        ? { kind: "authorized", userId: body.user_id }
        : { kind: "serviceUnavailable" }; // 200 but malformed → fault
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" }; // 503, 500, anything else → try again
  }
}

/**
 * Probe `GET /admin/me`. Gates on STATUS, not the body. The SOLE owner of the 401
 * refresh-retry (the store must never refresh on 401). The Bearer attaches ONLY to the
 * admin-API origin — never anywhere else. A null client → `authUnavailable` with NO
 * network call (do not fall through to a tokenless fetch, which would 401 → wrong
 * "login" bounce).
 */
export async function probeAdmin(signal?: AbortSignal): Promise<ProbeOutcome> {
  if (!supabase) return { kind: "authUnavailable" };
  const url = adminMeUrl();
  if (!url) return { kind: "serviceUnavailable" };

  // A timeout so a hung backend resolves to serviceUnavailable instead of hanging
  // forever; combined with the caller's supersession signal (whose aborts are dropped
  // by the store's epoch guard anyway).
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const send = (token: string): Promise<Response> =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: combined });

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return { kind: "unauthenticated" };

    let res = await send(session.access_token);
    if (res.status === 401) {
      const refreshed = await refreshOnce();
      if (!refreshed) return { kind: "unauthenticated" };
      res = await send(refreshed);
    }
    return classify(res);
  } catch {
    // timeout, supersession-abort, or a genuine network/CORS failure → all "try again".
    return { kind: "serviceUnavailable" };
  }
}
