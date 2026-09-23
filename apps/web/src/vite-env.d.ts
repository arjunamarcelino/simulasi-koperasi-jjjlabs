/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRANSPORT?: "mock" | "livekit";
  readonly VITE_TOKEN_ENDPOINT?: string;
  // Supabase auth (SIM-3). Both PUBLIC (ship in the bundle); optional so the app
  // still boots with zero env in a degraded no-auth mode. Only ever the anon /
  // publishable key here — never the RLS-bypassing secret key.
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
