import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../config/env";

/**
 * Minimal hand-written schema for the one table the FE reads directly. Kills the
 * query-builder `any` (createClient<Database>) without pulling in generated types.
 * Mirrors apps/db/supabase/migrations (profiles: id + display_name, RLS owner-only).
 */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string | null };
        Insert: { id: string; display_name?: string | null };
        Update: { id?: string; display_name?: string | null };
        Relationships: [];
      };
    };
    Views: { [key: string]: never };
    Functions: { [key: string]: never };
    Enums: { [key: string]: never };
    CompositeTypes: { [key: string]: never };
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * The single Supabase client for the app, or **null** when the public env is
 * absent (mock dev / misconfig) — callers must treat null as "degraded, no auth"
 * and keep running. PKCE is the browser-safe OAuth flow; detectSessionInUrl lets
 * the client finish the Google redirect on boot.
 */
export const supabase: TypedSupabaseClient | null =
  ENV.supabaseUrl && ENV.supabaseAnonKey
    ? createClient<Database>(ENV.supabaseUrl, ENV.supabaseAnonKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
