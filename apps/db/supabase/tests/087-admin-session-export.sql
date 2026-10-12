-- admin.session_results_export(date, date) row export + grant matrix (SIM-19).
--
-- Fixtures built INLINE inside begin/rollback (seeds are never loaded by `supabase test db`).
-- Self-contained scenario_definition rows (own codes/titles) so title + ordering asserts are
-- deterministic and independent of seed state. Expected values are hand-computed from the CONTRACT
-- shape, NOT re-derived from the SQL, so a formula bug can't write a self-confirming test. The grant
-- matrix is asserted via has_*_privilege (the real role→function execution is proven by the db e2e).
begin;
select plan(29);

select tests.create_user('se_u1');
select tests.create_user('se_u2');

-- Own scenario rows: one AVAILABLE, one COMING_SOON (D9 — historical/non-AVAILABLE must still export).
insert into public.scenario_definition (code, title, status) values
  ('test-se-a',  'Skenario A',  'AVAILABLE'),
  ('test-se-cs', 'Skenario CS', 'COMING_SOON');

-- 7 COMPLETED sessions on test-se-a (distinct started_at → total order), covering: normal, zero-duration,
-- empty rubric, non-numeric, out-of-range, and TWO poisoned top-level scores_json (array + JSON null)
-- that must NOT crash the function. started_at fixed in UTC so the ISO render + date filter are exact.
insert into public.sessions
  (user_id, scenario_id, started_at, ended_at, trigger, ending_type, scores_json)
values
  (tests.get_uid('se_u1'), 'test-se-a', '2026-03-01 10:00:00+00', '2026-03-01 10:02:05+00', 'manual',             'good',    '{"a":80,"b":90}'::jsonb),   -- idx0: avg 85.0, dur 125
  (tests.get_uid('se_u1'), 'test-se-a', '2026-03-02 10:00:00+00', '2026-03-02 10:00:00+00', 'manual',             'neutral', '{"a":0,"b":100}'::jsonb),   -- idx1: avg 50.0, dur 0 (zero-duration)
  (tests.get_uid('se_u1'), 'test-se-a', '2026-03-03 10:00:00+00', '2026-03-03 10:10:00+00', 'force_quit_level_2', 'bad',     '{}'::jsonb),                -- idx2: avg null (empty rubric)
  (tests.get_uid('se_u2'), 'test-se-a', '2026-03-04 10:00:00+00', '2026-03-04 10:10:00+00', 'manual',             'good',    '{"a":"high","b":90}'::jsonb),-- idx3: avg 90.0 (non-numeric skipped)
  (tests.get_uid('se_u2'), 'test-se-a', '2026-03-05 10:00:00+00', '2026-03-05 10:10:00+00', 'manual',             'good',    '{"a":-5,"b":150,"c":100}'::jsonb), -- idx4: avg 100.0 (out-of-range dropped)
  (tests.get_uid('se_u2'), 'test-se-a', '2026-03-06 10:00:00+00', '2026-03-06 10:10:00+00', 'manual',             'good',    '[1,2]'::jsonb),             -- idx5: avg null (TOP-LEVEL array — must not crash)
  (tests.get_uid('se_u2'), 'test-se-a', '2026-03-07 10:00:00+00', '2026-03-07 10:10:00+00', 'manual',             'good',    'null'::jsonb);              -- idx6: avg null (JSON null — must not crash)
-- OPEN session (never finalized) — must be EXCLUDED from the export.
insert into public.sessions (user_id, scenario_id, started_at)
  values (tests.get_uid('se_u1'), 'test-se-a', '2026-03-08 10:00:00+00');
-- COMPLETED session on the COMING_SOON scenario — must still export with its title (idx7, last by date).
insert into public.sessions
  (user_id, scenario_id, started_at, ended_at, trigger, ending_type, scores_json)
values
  (tests.get_uid('se_u1'), 'test-se-cs', '2026-03-09 10:00:00+00', '2026-03-09 10:05:00+00', 'manual', 'good', '{"x":70}'::jsonb);  -- idx7: avg 70.0

-- ── grant matrix (has_*_privilege, not SET ROLE) ────────────────────────────────────────────
select is(has_function_privilege('metrics_reader', 'admin.session_results_export(date,date)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE admin.session_results_export(date,date)');
select is(has_schema_privilege('metrics_reader', 'admin', 'USAGE'), true,
  'metrics_reader has USAGE on schema admin');
select is(has_table_privilege('metrics_reader', 'public.sessions', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on sessions');
select is(has_function_privilege('anon', 'admin.session_results_export(date,date)', 'EXECUTE'), false,
  'anon cannot EXECUTE admin.session_results_export(date,date)');
select is(has_function_privilege('authenticated', 'admin.session_results_export(date,date)', 'EXECUTE'), false,
  'authenticated cannot EXECUTE admin.session_results_export(date,date)');
select is(has_function_privilege('public', 'admin.session_results_export(date,date)', 'EXECUTE'), false,
  'public cannot EXECUTE admin.session_results_export(date,date)');

-- ── D2: completed only (OPEN row excluded) ───────────────────────────────────────────────────
select is(jsonb_array_length(admin.session_results_export(null, null)), 8,
  'exports 8 completed sessions (OPEN row excluded)');

-- ── D3: no PII ───────────────────────────────────────────────────────────────────────────────
select is(admin.session_results_export(null, null)::text like '%user_id%', false,
  'export carries no user_id (no PII)');
select is(admin.session_results_export(null, null)::text like '%display_name%', false,
  'export carries no display_name (no PII)');

-- ── D4: poisoned scores_json did not crash (function returns an array) ────────────────────────
select is(jsonb_typeof(admin.session_results_export(null, null)), 'array',
  'returns an array (top-level array/null scores_json rows did NOT crash it)');

-- ── D5: avg_score parity (object-guard + numeric + in-range 0..100 + round 1) ─────────────────
select is((admin.session_results_export(null, null) -> 0 ->> 'avg_score')::numeric, 85.0, 'idx0 avg_score = 85.0 ((80+90)/2)');
select is((admin.session_results_export(null, null) -> 1 ->> 'avg_score')::numeric, 50.0, 'idx1 avg_score = 50.0 (0 and 100 both in-range)');
select is( admin.session_results_export(null, null) -> 2 ->> 'avg_score', null, 'idx2 avg_score null (empty rubric)');
select is((admin.session_results_export(null, null) -> 3 ->> 'avg_score')::numeric, 90.0, 'idx3 avg_score = 90.0 (non-numeric "high" skipped)');
select is((admin.session_results_export(null, null) -> 4 ->> 'avg_score')::numeric, 100.0, 'idx4 avg_score = 100.0 (-5 and 150 out-of-range dropped)');
select is( admin.session_results_export(null, null) -> 5 ->> 'avg_score', null, 'idx5 avg_score null (top-level array)');
select is( admin.session_results_export(null, null) -> 6 ->> 'avg_score', null, 'idx6 avg_score null (JSON null)');

-- ── D7: ordering started_at asc; COMING_SOON session sorts last ───────────────────────────────
select is(admin.session_results_export(null, null) -> 0 ->> 'started_at', '2026-03-01T10:00:00Z', 'idx0 started_at earliest (ascending order)');
select is(admin.session_results_export(null, null) -> 7 ->> 'scenario_id', 'test-se-cs', 'idx7 is the last session by started_at');

-- ── D8: duration (incl. zero) + ISO-8601 UTC render ───────────────────────────────────────────
select is(admin.session_results_export(null, null) -> 0 ->> 'duration_seconds', '125', 'idx0 duration_seconds = 125');
select is(admin.session_results_export(null, null) -> 1 ->> 'duration_seconds', '0', 'idx1 duration_seconds = 0 (zero-duration session)');
select is(admin.session_results_export(null, null) -> 0 ->> 'started_at' like '%Z', true, 'started_at is an ISO-8601 UTC string (ends with Z)');

-- ── D9: historical/COMING_SOON scenario still exports with its title (not status-filtered) ─────
select is(admin.session_results_export(null, null) -> 7 ->> 'scenario_title', 'Skenario CS', 'COMING_SOON scenario still exports with its title');

-- ── D6: date filter — half-open [from, to+1d), UTC-anchored, to-day inclusive ─────────────────
select is(jsonb_array_length(admin.session_results_export('2026-03-03', '2026-03-05')), 3, 'from=03-03 to=03-05 → 3 rows (both days inclusive)');
select is(jsonb_array_length(admin.session_results_export(null, '2026-03-01')), 1, 'to=03-01 only → 1 row (to-day inclusive)');
select is(jsonb_array_length(admin.session_results_export('2026-03-09', null)), 1, 'from=03-09 only → 1 row (the COMING_SOON session)');
select is(jsonb_array_length(admin.session_results_export('2026-03-05', '2026-03-03')), 0, 'from > to → 0 rows (unsatisfiable range)');
select is(jsonb_array_length(admin.session_results_export('2099-01-01', null)), 0, 'future from → 0 rows');
select is(jsonb_array_length(admin.session_results_export('2026-03-02', '2026-03-02')), 1, 'equal from=to=03-02 → 1 row (that whole UTC day)');

select * from finish();
rollback;
