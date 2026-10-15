-- admin.metrics_overview() aggregation + grant matrix (SIM-15).
--
-- Fixtures are built INLINE (tests.create_user + direct inserts) inside begin/rollback —
-- seeds/dev_sessions.sql is a \set-parameterized dev script that `supabase test db` never
-- loads (config.toml seeds only seed.sql), so it cannot feed pgTAP.
--
-- The grant matrix is asserted via has_*_privilege (NOT `set local role metrics_reader` — the
-- real role→function execution is proven by scripts/e2e-metrics.mjs, which connects AS the role).
begin;
select plan(30);

-- ── fixture: 3 users, 10 ended sessions (+1 open, excluded), chosen for clean fractions ──
select tests.create_user('m_recent1');
select tests.create_user('m_recent2');
select tests.create_user('m_old');

-- A throwaway COMING_SOON scenario (none exist in the seed) to prove it's excluded.
insert into public.scenario_definition (code, title, status, sort_order)
  values ('zz-coming-soon', 'ZZ Coming Soon', 'COMING_SOON', 99);

-- 10 ended sessions, all kredit-macet (so per-scenario == overall for that row).
-- Recent (<=30d) for recent1/recent2; one 40d-old for m_old (⇒ active_30d excludes m_old).
-- scores_json covers: normal, empty {}, non-numeric value, TOP-LEVEL array, JSON 'null',
-- and an out-of-range value — the last three must NOT crash jsonb_each.
insert into public.sessions
  (user_id, scenario_id, started_at, ended_at, trigger, ending_type, scores_json)
values
  (tests.get_uid('m_recent1'), 'kredit-macet', now()-interval '1 day'  - interval '10 min', now()-interval '1 day',  'manual',             'good',    '{"a":80,"b":60}'::jsonb),   -- 70
  (tests.get_uid('m_recent1'), 'kredit-macet', now()-interval '2 day'  - interval '10 min', now()-interval '2 day',  'manual',             'good',    '{"a":100,"b":80}'::jsonb),  -- 90
  (tests.get_uid('m_recent1'), 'kredit-macet', now()-interval '3 day'  - interval '10 min', now()-interval '3 day',  'sinyal_level_1',     'neutral', '{"a":40,"b":60}'::jsonb),   -- 50
  (tests.get_uid('m_recent1'), 'kredit-macet', now()-interval '4 day'  - interval '10 min', now()-interval '4 day',  'force_quit_level_2', 'bad',     '{"a":20,"b":20}'::jsonb),   -- 20 (only non-completed)
  (tests.get_uid('m_recent1'), 'kredit-macet', now()-interval '5 day'  - interval '10 min', now()-interval '5 day',  'manual',             'good',    '{}'::jsonb),                -- null (empty rubric)
  (tests.get_uid('m_recent2'), 'kredit-macet', now()-interval '6 day'  - interval '10 min', now()-interval '6 day',  'manual',             'neutral', '{"a":"high"}'::jsonb),      -- null (non-numeric)
  (tests.get_uid('m_recent2'), 'kredit-macet', now()-interval '7 day'  - interval '10 min', now()-interval '7 day',  'manual',             'good',    '[1,2]'::jsonb),             -- null (TOP-LEVEL array — must not crash)
  (tests.get_uid('m_recent2'), 'kredit-macet', now()-interval '8 day'  - interval '10 min', now()-interval '8 day',  'manual',             'good',    'null'::jsonb),              -- null (JSON null — must not crash)
  (tests.get_uid('m_recent2'), 'kredit-macet', now()-interval '9 day'  - interval '10 min', now()-interval '9 day',  'manual',             'good',    '{"a":150,"b":40}'::jsonb),  -- 40 (150 out-of-range dropped)
  (tests.get_uid('m_old'),     'kredit-macet', now()-interval '40 day' - interval '10 min', now()-interval '40 day', 'manual',             'good',    '{"a":60,"b":60}'::jsonb);   -- 60 (outside 30d window)
-- OPEN row (ended_at/trigger/ending_type all null) — must be excluded from every metric.
insert into public.sessions (user_id, scenario_id, started_at)
  values (tests.get_uid('m_recent1'), 'kredit-macet', now()-interval '1 hour');

-- ── overall ──────────────────────────────────────────────────────────────────────────
-- total excludes the OPEN row ⇒ 10 (not 11).
select is((admin.metrics_overview() #>> '{sessions,total}')::int, 10, 'total = 10 ended (OPEN row excluded)');
-- completion = non-force_quit / total = 9/10.
select is((admin.metrics_overview() #>> '{sessions,completion_rate}')::numeric, 0.9, 'completion_rate = 0.9');
-- avg of per-session means over the 6 scored sessions: (70+90+50+20+40+60)/6 = 55.0.
select is((admin.metrics_overview() #>> '{sessions,avg_score}')::numeric, 55.0, 'avg_score = 55.0 (empty/non-numeric/array/null/out-of-range excluded)');
select is((admin.metrics_overview() #>> '{sessions,ending_split,good}')::numeric,    0.7, 'ending_split good = 0.7');
select is((admin.metrics_overview() #>> '{sessions,ending_split,neutral}')::numeric, 0.2, 'ending_split neutral = 0.2');
select is((admin.metrics_overview() #>> '{sessions,ending_split,bad}')::numeric,     0.1, 'ending_split bad = 0.1');

-- ── users ────────────────────────────────────────────────────────────────────────────
select is((admin.metrics_overview() #>> '{users,active_30d}')::int, 2, 'active_30d = 2 (m_old''s only session is 40d old)');
select is((admin.metrics_overview() #>> '{users,total_registered}')::int, 3, 'total_registered = 3');
select is((admin.metrics_overview() #>> '{users,new_7d}')::int, 3, 'new_7d = 3 (all created now)');

-- ── per_scenario ─────────────────────────────────────────────────────────────────────
-- 4 AVAILABLE scenarios; the COMING_SOON row is excluded.
select is(jsonb_array_length(admin.metrics_overview() -> 'per_scenario'), 4, 'per_scenario has 4 rows (COMING_SOON excluded)');
select is((select count(*)::int from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'zz-coming-soon'), 0, 'COMING_SOON scenario absent from per_scenario');
-- ordered by title: "Keanggotaan Fiktif" sorts first.
select is(admin.metrics_overview() #>> '{per_scenario,0,scenario_id}', 'keanggotaan-fiktif', 'per_scenario ordered by title (jsonb_agg order by)');
-- kredit-macet carries all 10 sessions.
select is((select (e ->> 'sessions')::int from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'kredit-macet'), 10, 'kredit-macet sessions = 10');
select is((select (e ->> 'completion_rate')::numeric from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'kredit-macet'), 0.9, 'kredit-macet completion_rate = 0.9');
select is((select (e ->> 'avg_score')::numeric from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'kredit-macet'), 55.0, 'kredit-macet avg_score = 55.0');
-- zero-session scenario still present with null rates (LEFT JOIN).
select is((select (e ->> 'sessions')::int from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'keanggotaan-fiktif'), 0, 'zero-session scenario present with sessions = 0');
select is((select e ->> 'completion_rate' from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'keanggotaan-fiktif'), null, 'zero-session completion_rate = null (no divide-by-zero)');
select is((select e ->> 'avg_score' from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'keanggotaan-fiktif'), null, 'zero-session avg_score = null');
select is((select e -> 'ending_split' from jsonb_array_elements(admin.metrics_overview() -> 'per_scenario') e
             where e ->> 'scenario_id' = 'keanggotaan-fiktif'), 'null'::jsonb, 'zero-session ending_split = JSON null');

-- ── no-crash + aggregate-only (privacy) invariant ─────────────────────────────────────
select is(jsonb_typeof(admin.metrics_overview()), 'object', 'function returns an object (poisoned rows did NOT crash it)');
select is(admin.metrics_overview() #>> '{generated_at}' like '%Z', true, 'generated_at is an ISO-8601 UTC string');
select is(admin.metrics_overview()::text like '%"user_id"%', false, 'output carries no user_id (aggregate-only)');
select is(admin.metrics_overview()::text like '%display_name%', false, 'output carries no display_name (aggregate-only)');

-- ── grant matrix (has_*_privilege, not SET ROLE) ──────────────────────────────────────
select is(has_function_privilege('metrics_reader', 'admin.metrics_overview()', 'EXECUTE'), true,
  'metrics_reader can EXECUTE admin.metrics_overview()');
select is(has_schema_privilege('metrics_reader', 'admin', 'USAGE'), true,
  'metrics_reader has USAGE on schema admin');
select is(has_table_privilege('metrics_reader', 'public.sessions', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on sessions');
select is(has_table_privilege('metrics_reader', 'public.profiles', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on profiles');
select is(has_function_privilege('anon', 'admin.metrics_overview()', 'EXECUTE'), false,
  'anon cannot EXECUTE admin.metrics_overview()');
select is(has_function_privilege('authenticated', 'admin.metrics_overview()', 'EXECUTE'), false,
  'authenticated cannot EXECUTE admin.metrics_overview()');
select is(has_function_privilege('public', 'admin.metrics_overview()', 'EXECUTE'), false,
  'public cannot EXECUTE admin.metrics_overview()');

select * from finish();
rollback;
