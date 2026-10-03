/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Supabase auth. Both PUBLIC (ship in the bundle); optional so the app still boots
  // with zero env in a degraded "auth unavailable" mode. Only ever the anon /
  // publishable key here — NEVER the RLS-bypassing service_role key.
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // Origin of the FastAPI backend that serves GET /admin/me (SIM-14).
  readonly VITE_ADMIN_API_ENDPOINT?: string;
  // Cloudflare Turnstile site key. PUBLIC; optional (unset → no widget). Supabase
  // CAPTCHA is project-global, so admin password login needs this when it's enabled.
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
