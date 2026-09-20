import { supabase } from "./supabase";

/**
 * fetch() that attaches the Supabase access token when signed in, with a single
 * 401-only refresh-and-retry.
 *
 * - Reads the session directly from the Supabase client (not the auth store) so it
 *   works before the store has hydrated and carries no store coupling.
 * - Adds `Authorization: Bearer` ONLY when a session exists (null → no header,
 *   never a dangling `Bearer undefined`).
 * - On 401 (token aged out between getSession and the call), forces a genuinely new
 *   token via refreshSession and retries ONCE. autoRefreshToken covers steady state.
 * - Does NOT retry 403 — that's a real authorization denial, not a stale token.
 * - Degraded (no Supabase env): a plain unauthenticated fetch.
 *
 * SIM-4 note: adding the Authorization header makes the /token call CORS-preflighted;
 * the backend must allow the header and verify the JWT (JWKS/ES256, exp/aud/iss).
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  if (!supabase) return fetch(input, init);

  const send = (token: string | undefined): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await send(session?.access_token);
  if (res.status !== 401) return res;

  const {
    data: { session: refreshed },
  } = await supabase.auth.refreshSession();
  if (!refreshed?.access_token) return res; // refresh failed — surface the original 401
  return send(refreshed.access_token);
}
