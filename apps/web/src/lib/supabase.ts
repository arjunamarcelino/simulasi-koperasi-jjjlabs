import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../config/env";

/** A JSON value — the honest wire type for every jsonb-returning RPC. Narrowed TS
 * result contracts (progressRepo.contracts) are layered on top of this at the repo
 * boundary; postgREST does not validate the shape for us. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Minimal hand-written schema for the tables/RPCs the FE touches. Kills the
 * query-builder `any` (createClient<Database>) without pulling in generated types.
 * Mirrors apps/db/supabase/migrations. RPC Args are narrowed (we build them); every
 * jsonb Returns stays `Json` (the DB produces it — validate at the repo boundary).
 * Follow-up: wire `supabase gen types typescript --local` + a CI diff to kill drift.
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
      // Persisted AI-Auditor results. Owner-select RLS scopes reads to auth.uid();
      // a row is FINALIZED exactly when ended_at is not null (DB constraints tie
      // ended_at ⇔ trigger ⇔ ending_type). jsonb columns stay Json — validated at
      // the repo boundary (sessionsRepo.contracts).
      sessions: {
        Row: {
          id: string;
          user_id: string;
          scenario_id: string;
          started_at: string;
          ended_at: string | null;
          trigger: string | null;
          ending_type: string | null;
          scores_json: Json;
          state_json: Json;
          narrative_feedback: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          scenario_id: string;
          started_at?: string;
        };
        Update: { ended_at?: string | null };
        Relationships: [];
      };
    };
    Views: {
      quiz_catalog: {
        Row: { code: string; prompt: string; options: Json; sort_order: number };
        Relationships: [];
      };
    };
    Functions: {
      get_my_progress: { Args: Record<PropertyKey, never>; Returns: Json };
      claim_mission: { Args: { p_mission_id: string; p_code?: string | null }; Returns: Json };
      redeem_voucher: { Args: { p_voucher_id: string }; Returns: Json };
      submit_quiz: { Args: { p_answers: { code: string; choice: number }[] }; Returns: Json };
      reconcile_local_progress: {
        Args: { p_uid: string; p_xp: number; p_missions: string[] };
        Returns: Json;
      };
      sync_badges: { Args: { p_codes: string[] }; Returns: undefined };
    };
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
