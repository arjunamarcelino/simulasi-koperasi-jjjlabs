/**
 * Admin app env. No eager validation — the app must still boot with zero env
 * (lib/supabase.ts degrades to a null client → the UI shows "auth unavailable").
 * All keys are PUBLIC/build-time; the service_role key is NEVER referenced here.
 */
export const ENV = {
  // Left `string | undefined` on purpose so "is it configured?" is a plain truthiness
  // check and new URL() is never called on "".
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  adminApiEndpoint: import.meta.env.VITE_ADMIN_API_ENDPOINT,
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
} as const;
