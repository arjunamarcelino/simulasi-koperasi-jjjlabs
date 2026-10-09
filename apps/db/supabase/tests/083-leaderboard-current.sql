-- public.leaderboard_current() — the game-facing read (SIM-17).
--
-- Asserts: empty before any capture; reads the LATEST season (max season_number); rank order;
-- the PII boundary (columns are exactly display_name/xp/level/rank — NO user_id); and the public
-- grant (anon/authenticated EXECUTE, public revoked). Fixtures inline in begin/rollback.
begin;
select plan(9);

select tests.create_user('c1', '{"name":"Budi"}');
select tests.create_user('c2', '{"name":"Sari"}');
select tests.create_user('c3', '{"name":"Tono"}');
update public.user_progress set xp = 1000 where user_id = tests.get_uid('c1');
update public.user_progress set xp = 500  where user_id = tests.get_uid('c2');
update public.user_progress set xp = 200  where user_id = tests.get_uid('c3');

-- ── before any capture: empty board ─────────────────────────────────────────────────────────
select is((select count(*)::int from public.leaderboard_current()), 0, 'no season yet → leaderboard_current() returns 0 rows');

-- ── season #1: Budi leads ───────────────────────────────────────────────────────────────────
create temporary table c_cap1 as select admin.capture_leaderboard_snapshot('Musim 1');  -- invoke once
select is((select count(*)::int from public.leaderboard_current()), 3, 'season 1: 3 rows (xp>0)');
select is((select display_name from public.leaderboard_current() where rank = 1), 'Budi', 'season 1: rank 1 = Budi');

-- ── season #2 captured after Tono surges → latest season is used ─────────────────────────────
update public.user_progress set xp = 5000 where user_id = tests.get_uid('c3');
create temporary table c_cap2 as select admin.capture_leaderboard_snapshot('Musim 2');  -- invoke once
select is((select display_name from public.leaderboard_current() where rank = 1), 'Tono', 'latest season: rank 1 = Tono (not stale season 1)');
select is((select count(*)::int from public.leaderboard_current()), 3, 'latest season: 3 rows');

-- ── PII boundary: exactly the 4 display columns, no user_id ──────────────────────────────────
create temporary view lc as select * from public.leaderboard_current();
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns where table_name = 'lc'),
  'display_name,xp,level,rank',
  'leaderboard_current() exposes exactly display_name,xp,level,rank (no user_id)');

-- ── grant matrix ────────────────────────────────────────────────────────────────────────────
select is(has_function_privilege('anon', 'public.leaderboard_current()', 'EXECUTE'), true,
  'anon can EXECUTE leaderboard_current()');
select is(has_function_privilege('authenticated', 'public.leaderboard_current()', 'EXECUTE'), true,
  'authenticated can EXECUTE leaderboard_current()');
select is(has_function_privilege('public', 'public.leaderboard_current()', 'EXECUTE'), false,
  'PUBLIC pseudo-role has NO EXECUTE (revoked; granted only to anon/authenticated)');

select * from finish();
rollback;
