import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../config/env";

/**
 * Minimal EMPTY schema. The admin app touches NO PostgREST tables — its only data
 * path is the backend `GET /admin/me`, not supabase-js queries. An empty schema kills
 * the query-builder `any` (which `no-explicit-any` would reject) WITHOUT importing the
 * game's Database type, which would couple the admin build to game schema drift it
 * never uses.
 */
export type AdminDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type TypedSupabaseClient = SupabaseClient<AdminDatabase>;

/**
 * The single Supabase client, or **null** when the public env is absent (degraded —
 * the UI shows a terminal "auth unavailable" screen and never renders the shell).
 * Password-only: no OAuth redirect, so PKCE / detectSessionInUrl are off;
 * persistSession + autoRefreshToken stay on. Only the anon key — never the secret key.
 */
export const supabase: TypedSupabaseClient | null =
  ENV.supabaseUrl && ENV.supabaseAnonKey
    ? createClient<AdminDatabase>(ENV.supabaseUrl, ENV.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
