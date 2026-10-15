-- admin.capture_leaderboard_snapshot / delete_leaderboard_season / leaderboard_overview (SIM-17).
--
-- Fixtures built INLINE inside begin/rollback. XP is set directly on user_progress (the capture
-- reads user_progress.xp, the server-authoritative source). Expected ranks/levels are hand-computed
-- from the CONTRACT shape, NOT re-derived from the SQL. Each write function is invoked ONCE and its
-- result stashed in a temp table (calling it again would create/delete another season). The grant
-- matrix is asserted via has_*_privilege (the real role→function execution is proven by the e2e in
-- db-tests.yml).
begin;
select plan(45);

-- u1 Budi 1500 (lvl6), u2 null-name 600 (lvl4), u3 100, u5 100 (tie with u3), u4 0 (excluded).
select tests.create_user('u1', '{"name":"Budi"}');
select tests.create_user('u2');                    -- no name → coalesced to 'Anggota'
select tests.create_user('u3', '{"name":"Citra"}');
select tests.create_user('u4', '{"name":"Dedi"}');
select tests.create_user('u5', '{"name":"Eka"}');

update public.user_progress set xp = 1500 where user_id = tests.get_uid('u1');
update public.user_progress set xp = 600  where user_id = tests.get_uid('u2');
update public.user_progress set xp = 100  where user_id = tests.get_uid('u3');
update public.user_progress set xp = 0    where user_id = tests.get_uid('u4');
update public.user_progress set xp = 100  where user_id = tests.get_uid('u5');

-- ── capture season #1 (invoke ONCE) ────────────────────────────────────────────────────────
create temporary table cap1 as select admin.capture_leaderboard_snapshot('Musim Uji') as r;
select is((select (r->>'entry_count')::int from cap1), 4, 'capture: entry_count = 4 (xp=0 excluded)');
select is((select (r->>'season_number')::int from cap1), 1, 'capture: first season_number = 1');
select is((select (r->>'captured_at') from cap1) like '%Z', true, 'capture: captured_at is ISO-8601 UTC');

-- ── overview(null) selects the latest (only) season #1 ──────────────────────────────────────
select is((admin.leaderboard_overview(null) #>> '{selected,season_number}')::int, 1, 'overview(null): latest season = 1');
select is((admin.leaderboard_overview(null) #>> '{selected,label}'), 'Musim Uji', 'overview: label stored');
select is((admin.leaderboard_overview(null) #>> '{selected,entry_count}')::int, 4, 'overview: selected.entry_count = 4');
select is(jsonb_array_length(admin.leaderboard_overview(null) #> '{selected,entries}'), 4, 'overview: 4 entries');

-- ranks ordered by xp desc, contiguous 1..4
select is((admin.leaderboard_overview(null) #>> '{selected,entries,0,rank}')::int, 1, 'rank[0] = 1');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,0,display_name}'), 'Budi', 'rank[0] name = Budi');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,0,xp}')::int, 1500, 'rank[0] xp = 1500');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,0,level}')::int, 6, 'rank[0] level = 6 (frozen)');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,1,display_name}'), 'Anggota', 'rank[1] null name → Anggota');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,1,xp}')::int, 600, 'rank[1] xp = 600');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,1,level}')::int, 4, 'rank[1] level = 4');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,3,rank}')::int, 4, 'rank[3] = 4 (contiguous, no gaps)');
-- tie pair (u3,u5 both xp 100) occupy the last two ranks
select is((admin.leaderboard_overview(null) #>> '{selected,entries,2,xp}')::int, 100, 'rank[2] xp = 100 (tie)');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,3,xp}')::int, 100, 'rank[3] xp = 100 (tie)');

-- ── PII: the admin overview never carries user_id ───────────────────────────────────────────
select is(admin.leaderboard_overview(null)::text like '%user_id%', false, 'overview carries no user_id');

-- ── frozen: mutating source xp does NOT change an already-captured season ────────────────────
update public.user_progress set xp = 50 where user_id = tests.get_uid('u1');
select is((admin.leaderboard_overview(null) #>> '{selected,entries,0,xp}')::int, 1500, 'frozen: season #1 rank[0] still xp 1500 after source change');

-- ── ON DELETE SET NULL: deleting a player preserves their frozen standing ────────────────────
-- The flagship FK invariant (migration header): entry.user_id is SET NULL, NOT cascade, so a
-- deleted player's past rank/name/xp/level survive. u2 is rank 2 ('Anggota', xp 600, level 4).
-- Delete the auth.users row (cascades to profiles → fires SET NULL on the entry's user_id).
delete from auth.users where id = tests.get_uid('u2');
select is(
  (select user_id from public.leaderboard_entries e
     where e.season_id = (select (r->>'season_id')::uuid from cap1) and e.rank = 2),
  null, 'SET NULL: deleting a player NULLs entry.user_id (no cascade)');
select is(
  (select display_name from public.leaderboard_entries e
     where e.season_id = (select (r->>'season_id')::uuid from cap1) and e.rank = 2),
  'Anggota', 'SET NULL: the deleted player''s frozen display_name survives');
select is(
  (select count(*)::int from public.leaderboard_entries e
     where e.season_id = (select (r->>'season_id')::uuid from cap1)),
  4, 'SET NULL: entry row count unchanged after player deletion');

-- ── capture season #2 (latest switches) ─────────────────────────────────────────────────────
create temporary table cap2 as select admin.capture_leaderboard_snapshot(null) as r;  -- null label allowed
select is((select (r->>'season_number')::int from cap2), 2, 'capture: second season_number = 2');
select is((admin.leaderboard_overview(null) #>> '{selected,label}'), null, 'overview: null label stored as null');
select is(jsonb_array_length(admin.leaderboard_overview(null) -> 'seasons'), 2, 'overview: 2 seasons listed');
select is((admin.leaderboard_overview(null) #>> '{selected,season_number}')::int, 2, 'overview(null): latest is now season 2');
select is((admin.leaderboard_overview((select (r->>'season_id')::uuid from cap1)) #>> '{selected,season_number}')::int, 1,
  'overview(season1_id): selects season 1 explicitly');

-- ── delete: absent id → {deleted:false}; real delete cascades + promotes latest ─────────────
create temporary table del_absent as select admin.delete_leaderboard_season(gen_random_uuid()) as r;
select is((select (r->>'deleted')::boolean from del_absent), false, 'delete(absent): deleted = false (backend maps to 404)');

create temporary table del2 as select admin.delete_leaderboard_season((select (r->>'season_id')::uuid from cap2)) as r;
select is((select (r->>'deleted')::boolean from del2), true, 'delete(season2): deleted = true');
select is((select (r->>'season_number')::int from del2), 2, 'delete(season2): returns season_number 2');
select is((admin.leaderboard_overview(null) #>> '{selected,season_number}')::int, 1, 'after delete: latest promotes back to season 1');
select is(jsonb_array_length(admin.leaderboard_overview(null) -> 'seasons'), 1, 'after delete: 1 season listed');
-- cascade: season 2's entries are gone
select is((select count(*)::int from public.leaderboard_entries e
             where e.season_id = (select (r->>'season_id')::uuid from cap2)), 0, 'delete cascades entries');

-- ── empty capture: all-zero XP base → valid 0-entry season ──────────────────────────────────
update public.user_progress set xp = 0;
create temporary table cap_empty as select admin.capture_leaderboard_snapshot('Kosong') as r;
select is((select (r->>'entry_count')::int from cap_empty), 0, 'empty capture: entry_count = 0 (allowed)');
select is(jsonb_array_length(admin.leaderboard_overview(null) #> '{selected,entries}'), 0, 'empty capture: selected.entries = []');

-- ── grant matrix (has_*_privilege, not SET ROLE) ────────────────────────────────────────────
select is(has_function_privilege('metrics_reader', 'admin.capture_leaderboard_snapshot(text)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE capture');
select is(has_function_privilege('metrics_reader', 'admin.delete_leaderboard_season(uuid)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE delete');
select is(has_function_privilege('metrics_reader', 'admin.leaderboard_overview(uuid)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE overview');
select is(has_schema_privilege('metrics_reader', 'admin', 'USAGE'), true, 'metrics_reader has USAGE on admin');
select is(has_table_privilege('metrics_reader', 'public.leaderboard_seasons', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on leaderboard_seasons');
select is(has_table_privilege('metrics_reader', 'public.leaderboard_entries', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on leaderboard_entries');
select is(has_function_privilege('anon', 'admin.capture_leaderboard_snapshot(text)', 'EXECUTE'), false,
  'anon cannot EXECUTE capture');
select is(has_function_privilege('authenticated', 'admin.capture_leaderboard_snapshot(text)', 'EXECUTE'), false,
  'authenticated cannot EXECUTE capture');
select is(has_function_privilege('public', 'admin.leaderboard_overview(uuid)', 'EXECUTE'), false,
  'public cannot EXECUTE overview');
select is(has_function_privilege('anon', 'admin.delete_leaderboard_season(uuid)', 'EXECUTE'), false,
  'anon cannot EXECUTE delete');

select * from finish();
rollback;
