-- Dev-only seed: a handful of FINALIZED sessions so the profile "Riwayat" tab has data
-- to render before SIM-6 (the write path) lands. Covers multiple scenarios, all three
-- ending types, and a tutorial row (empty score/state maps) to exercise best-result
-- ranking + grouping + the narrative-only detail view.
--
-- NEVER run against production. Runs as the DB owner (bypasses RLS).
-- It intentionally writes fully-finalized rows directly, bypassing record_session_result
-- (the anti-forgery finalization path). That is fine for a dev fixture but must NEVER be
-- adapted into any client or production code path.
--
-- Usage (local Supabase):
--   1. Find your auth uid:  select id, email from auth.users;
--   2. psql "$LOCAL_DB_URL" -v uid="<that-uuid>" -f apps/db/supabase/seeds/dev_sessions.sql
--
-- scenario_id values FK scenario_definition(code) (seeded from @simkop/catalog in seed.sql).

\set ON_ERROR_STOP on

-- Idempotent: clear this dev user's history first so re-running doesn't stack duplicates.
delete from public.sessions where user_id = :'uid';

insert into public.sessions
  (user_id, scenario_id, started_at, ended_at, trigger, ending_type,
   scores_json, state_json, narrative_feedback)
values
  -- kredit-macet: an early failure then a later win → best = the "good" run
  (:'uid', 'kredit-macet',
   now() - interval '3 days', now() - interval '3 days' + interval '11 min',
   'manual', 'bad',
   '{"member_centric": 40, "compliance": 35}'::jsonb,
   '{"State_Jalur_Remedi": "SALAH"}'::jsonb,
   'Analisis jalur remedi belum tajam; anggota dirugikan.'),
  (:'uid', 'kredit-macet',
   now() - interval '1 day', now() - interval '1 day' + interval '14 min',
   'manual', 'good',
   '{"member_centric": 82, "compliance": 76}'::jsonb,
   '{"State_Jalur_Remedi": "BENAR"}'::jsonb,
   'Keputusan remedi kuat dan berpihak pada anggota.'),

  -- rapat-anggota-tahunan: a single neutral run
  (:'uid', 'rapat-anggota-tahunan',
   now() - interval '2 days', now() - interval '2 days' + interval '20 min',
   'sinyal_level_1', 'neutral',
   '{"soft_skills": 58, "compliance": 61}'::jsonb,
   '{"State_Proses_Rapat": "TUNTAS"}'::jsonb,
   'Rapat selesai, tetapi beberapa keputusan masih menggantung.'),

  -- tutorial: scored maps empty → renders narrative-only, sums to 0
  (:'uid', 'tutorial-koperasi-konsumen',
   now() - interval '5 days', now() - interval '5 days' + interval '6 min',
   'manual', 'good',
   '{}'::jsonb, '{}'::jsonb,
   'Selamat! Kamu telah menyelesaikan tutorial koperasi konsumen.');
