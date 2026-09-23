export type TransportKind = "mock" | "livekit";

function readTransport(): TransportKind {
  return import.meta.env.VITE_TRANSPORT === "livekit" ? "livekit" : "mock";
}

/**
 * Without any .env, this must still run. So "mock" is the default, not merely
 * one of the options. Set VITE_TRANSPORT=livekit + VITE_TOKEN_ENDPOINT to hit
 * the real backend.
 */
export const ENV = {
  transport: readTransport(),
  tokenEndpoint: import.meta.env.VITE_TOKEN_ENDPOINT ?? "",
  // Left `string | undefined` on purpose — NO eager validation here. The app must
  // still boot with zero env (lib/supabase.ts degrades to a null client).
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  // Cloudflare Turnstile site key (public; ships in the bundle). Unset → no widget,
  // anon sign-in stays tokenless (SIM-41). Optional, same no-eager-validation rule.
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
} as const;
