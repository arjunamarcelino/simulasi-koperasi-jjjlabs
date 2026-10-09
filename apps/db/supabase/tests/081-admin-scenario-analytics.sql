-- admin.scenario_analytics(text) aggregation + grant matrix (SIM-16).
--
-- Fixtures built INLINE inside begin/rollback (seeds/dev_sessions.sql is never loaded by
-- `supabase test db`). Expected values are hand-computed from the CONTRACT.md shape, NOT
-- re-derived from the SQL formula (so a formula bug can't write a self-confirming test).
-- The grant matrix is asserted via has_*_privilege (the real role→function execution is proven
-- by the real-role e2e in db-tests.yml).
begin;
select plan(37);

select tests.create_user('s_u1');
select tests.create_user('s_u2');

-- ── kredit-macet: 9 ended sessions, chosen for clean fractions + boundary coverage ──────
-- Pillar keys are intentionally generic ("a"/"b") — the function discovers keys dynamically.
-- scores_json covers: normal, boundary (0,20,21,40,60,61,80,100), empty {}, non-numeric,
-- TOP-LEVEL array, JSON 'null', and out-of-range 150 — the poisoned ones must NOT crash.
insert into public.sessions
  (user_id, scenario_id, started_at, ended_at, trigger, ending_type, scores_json)
values
  (tests.get_uid('s_u1'), 'kredit-macet', now()-interval '1 day' -interval '10 min', now()-interval '1 day', 'manual',             'good',    '{"a":0,"b":100}'::jsonb),   -- mean 50; a→b0, b→b4
  (tests.get_uid('s_u1'), 'kredit-macet', now()-interval '2 day' -interval '10 min', now()-interval '2 day', 'manual',             'good',    '{"a":20,"b":80}'::jsonb),   -- mean 50; a→b0, b→b3
  (tests.get_uid('s_u1'), 'kredit-macet', now()-interval '3 day' -interval '10 min', now()-interval '3 day', 'sinyal_level_1',     'neutral', '{"a":21,"b":61}'::jsonb),   -- mean 41; a→b1, b→b3
  (tests.get_uid('s_u1'), 'kredit-macet', now()-interval '4 day' -interval '10 min', now()-interval '4 day', 'force_quit_level_2', 'bad',     '{"a":40,"b":60}'::jsonb),   -- mean 50; a→b1, b→b2 (only non-completed)
  (tests.get_uid('s_u2'), 'kredit-macet', now()-interval '5 day' -interval '10 min', now()-interval '5 day', 'manual',             'good',    '{}'::jsonb),                -- null (empty rubric)
  (tests.get_uid('s_u2'), 'kredit-macet', now()-interval '6 day' -interval '10 min', now()-interval '6 day', 'manual',             'neutral', '{"a":"high"}'::jsonb),      -- null (non-numeric)
  (tests.get_uid('s_u2'), 'kredit-macet', now()-interval '7 day' -interval '10 min', now()-interval '7 day', 'manual',             'good',    '[1,2]'::jsonb),             -- null (TOP-LEVEL array — must not crash)
  (tests.get_uid('s_u2'), 'kredit-macet', now()-interval '8 day' -interval '10 min', now()-interval '8 day', 'manual',             'good',    'null'::jsonb),              -- null (JSON null — must not crash)
  (tests.get_uid('s_u2'), 'kredit-macet', now()-interval '9 day' -interval '10 min', now()-interval '9 day', 'manual',             'good',    '{"a":150,"b":41}'::jsonb);  -- mean 41 (a=150 dropped); b→b2
-- OPEN row (never finalized) — must be excluded from every metric.
insert into public.sessions (user_id, scenario_id, started_at)
  values (tests.get_uid('s_u1'), 'kredit-macet', now()-interval '1 hour');

-- tutorial: 2 ended sessions, both empty rubric → pillars [], avg_score null.
insert into public.sessions (user_id, scenario_id, started_at, ended_at, trigger, ending_type, scores_json)
values
  (tests.get_uid('s_u1'), 'tutorial-koperasi-konsumen', now()-interval '10 min', now(), 'manual', 'good', '{}'::jsonb),
  (tests.get_uid('s_u2'), 'tutorial-koperasi-konsumen', now()-interval '10 min', now(), 'manual', 'good', '{}'::jsonb);
-- keanggotaan-fiktif: NO sessions (valid, zero-session scenario).

-- ── kredit-macet: outcome ───────────────────────────────────────────────────────────────
select is((admin.scenario_analytics('kredit-macet') #>> '{attempts}')::int, 9, 'attempts = 9 (OPEN row excluded)');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,completed}')::int, 8, 'completed = 8 (not force_quit_level_2)');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,bubar}')::int, 1, 'bubar = 1 (force_quit_level_2)');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,by_trigger,manual}')::int, 7, 'by_trigger.manual = 7');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,by_trigger,sinyal_level_1}')::int, 1, 'by_trigger.sinyal_level_1 = 1');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,by_trigger,force_quit_level_2}')::int, 1, 'by_trigger.force_quit_level_2 = 1');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,ending_counts,good}')::int, 6, 'ending_counts.good = 6');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,ending_counts,neutral}')::int, 2, 'ending_counts.neutral = 2');
select is((admin.scenario_analytics('kredit-macet') #>> '{outcome,ending_counts,bad}')::int, 1, 'ending_counts.bad = 1');

-- ── kredit-macet: avg_score = mean of per-session rubric means over scored sessions ───────
-- scored: 50,50,41,50,41 → 232/5 = 46.4 (empty/non-numeric/array/null excluded; 150 out-of-range dropped).
select is((admin.scenario_analytics('kredit-macet') #>> '{avg_score}')::numeric, 46.4, 'avg_score = 46.4');

-- ── kredit-macet: pillar distribution (keys ordered a,b) ──────────────────────────────────
select is(jsonb_array_length(admin.scenario_analytics('kredit-macet') -> 'pillars'), 2, 'pillars has 2 keys (a,b)');
select is(admin.scenario_analytics('kredit-macet') #>> '{pillars,0,key}', 'a', 'pillar[0].key = a (ordered)');
select is((admin.scenario_analytics('kredit-macet') #>> '{pillars,0,count}')::int, 4, 'pillar a count = 4 (150 dropped)');
select is((admin.scenario_analytics('kredit-macet') #>> '{pillars,0,avg}')::numeric, 20.3, 'pillar a avg = 20.3 ((0+20+21+40)/4)');
-- boundary coverage: 0,20 → band0 ; 21,40 → band1.
select is(admin.scenario_analytics('kredit-macet') #> '{pillars,0,buckets}', '[2,2,0,0,0]'::jsonb, 'pillar a buckets = [2,2,0,0,0]');
select is(admin.scenario_analytics('kredit-macet') #>> '{pillars,1,key}', 'b', 'pillar[1].key = b');
select is((admin.scenario_analytics('kredit-macet') #>> '{pillars,1,count}')::int, 5, 'pillar b count = 5');
select is((admin.scenario_analytics('kredit-macet') #>> '{pillars,1,avg}')::numeric, 68.4, 'pillar b avg = 68.4 ((100+80+61+60+41)/5)');
-- boundary coverage: 41,60 → band2 ; 61,80 → band3 ; 100 → band4.
select is(admin.scenario_analytics('kredit-macet') #> '{pillars,1,buckets}', '[0,0,2,2,1]'::jsonb, 'pillar b buckets = [0,0,2,2,1]');

-- ── contract invariants ───────────────────────────────────────────────────────────────────
select is(admin.scenario_analytics('kredit-macet') -> 'dropoff', 'null'::jsonb, 'dropoff is JSON null (Core)');
select is(admin.scenario_analytics('kredit-macet') #>> '{title}', 'Kredit Macet', 'title present');
select is(admin.scenario_analytics('kredit-macet') #>> '{generated_at}' like '%Z', true, 'generated_at is an ISO-8601 UTC string');
select is(admin.scenario_analytics('kredit-macet')::text like '%"user_id"%', false, 'output carries no user_id (aggregate-only)');

-- ── tutorial: no rubric → pillars [], avg_score null (outcome still counts) ────────────────
select is((admin.scenario_analytics('tutorial-koperasi-konsumen') #>> '{attempts}')::int, 2, 'tutorial attempts = 2');
select is(jsonb_array_length(admin.scenario_analytics('tutorial-koperasi-konsumen') -> 'pillars'), 0, 'tutorial pillars = [] (no numeric rubric)');
select is(admin.scenario_analytics('tutorial-koperasi-konsumen') #>> '{avg_score}', null, 'tutorial avg_score = null');

-- ── zero-session but VALID scenario → well-formed attempts:0 object (distinct from 404) ─────
select is((admin.scenario_analytics('keanggotaan-fiktif') #>> '{attempts}')::int, 0, 'zero-session attempts = 0');
select is(jsonb_array_length(admin.scenario_analytics('keanggotaan-fiktif') -> 'pillars'), 0, 'zero-session pillars = []');
select is(admin.scenario_analytics('keanggotaan-fiktif') #>> '{avg_score}', null, 'zero-session avg_score = null');
select is(admin.scenario_analytics('keanggotaan-fiktif') #>> '{title}', 'Keanggotaan Fiktif', 'zero-session title present');

-- ── no-crash invariant (poisoned rows above did not raise) ──────────────────────────────────
select is(jsonb_typeof(admin.scenario_analytics('kredit-macet')), 'object', 'function returns an object (poisoned rows did NOT crash it)');

-- ── grant matrix (has_*_privilege, not SET ROLE) ────────────────────────────────────────────
select is(has_function_privilege('metrics_reader', 'admin.scenario_analytics(text)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE admin.scenario_analytics(text)');
select is(has_schema_privilege('metrics_reader', 'admin', 'USAGE'), true,
  'metrics_reader has USAGE on schema admin');
select is(has_table_privilege('metrics_reader', 'public.sessions', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on sessions');
select is(has_function_privilege('anon', 'admin.scenario_analytics(text)', 'EXECUTE'), false,
  'anon cannot EXECUTE admin.scenario_analytics(text)');
select is(has_function_privilege('authenticated', 'admin.scenario_analytics(text)', 'EXECUTE'), false,
  'authenticated cannot EXECUTE admin.scenario_analytics(text)');
select is(has_function_privilege('public', 'admin.scenario_analytics(text)', 'EXECUTE'), false,
  'public cannot EXECUTE admin.scenario_analytics(text)');

select * from finish();
rollback;
