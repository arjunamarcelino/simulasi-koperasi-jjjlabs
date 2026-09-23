import { supabase } from "./supabase";
import { ENV } from "../config/env";

/**
 * fetch() that attaches the Supabase access token when signed in, with a single
 * 401-only refresh-and-retry.
 *
 * - Reads the session directly from the Supabase client (not the auth store) so it
 *   works before the store has hydrated and carries no store coupling.
 * - Attaches `Authorization: Bearer` ONLY when a session exists AND the target is an
 *   allowed origin (same-origin or the configured token endpoint), so the JWT can
 *   never leak to a foreign host a future caller might pass in. Never a dangling
 *   `Bearer undefined`.
 * - On 401 (token aged out between getSession and the call), forces a genuinely new
 *   token via refreshSession and retries ONCE. Concurrent 401s share one refresh
 *   (dedup) so the refresh token isn't rotated N times for one staleness event.
 * - Does NOT retry 403 — that's a real authorization denial, not a stale token.
 * - Degraded (no Supabase env): a plain unauthenticated fetch.
 *
 * SIM-4 note: adding the Authorization header makes the /token call CORS-preflighted;
 * the backend must allow the header and verify the JWT (JWKS/ES256, exp/aud/iss).
 */

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

function targetUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Same-origin or the configured token endpoint — never attach the JWT elsewhere. */
function isAllowedTarget(input: RequestInfo | URL): boolean {
  try {
    const origin = new URL(targetUrl(input), window.location.origin).origin;
    if (origin === window.location.origin) return true;
    return !!ENV.tokenEndpoint && origin === new URL(ENV.tokenEndpoint).origin;
  } catch {
    return false;
  }
}

export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!supabase) return fetch(input, init);
  const allowed = isAllowedTarget(input);

  const send = (token: string | undefined): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (token && allowed) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await send(session?.access_token);
  if (res.status !== 401 || !allowed) return res; // 403/other, or a foreign target → no refresh

  const refreshed = await refreshOnce();
  if (!refreshed) return res; // refresh failed — surface the original 401
  return send(refreshed);
}
