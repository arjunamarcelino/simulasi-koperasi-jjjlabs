-- Schema smoke: RLS is on everywhere, seed loaded, level derivation, and the
-- integrity constraints that protect real invariants (not exhaustive DDL mirroring).
begin;
select plan(28);

-- RLS enabled on every public table (10).
select tests.rls_enabled('public', 'profiles');
select tests.rls_enabled('public', 'user_progress');
select tests.rls_enabled('public', 'scenario_definition');
select tests.rls_enabled('public', 'sessions');
select tests.rls_enabled('public', 'mission_definition');
select tests.rls_enabled('public', 'mission_completion');
select tests.rls_enabled('public', 'voucher_definition');
select tests.rls_enabled('public', 'voucher_redemption');
select tests.rls_enabled('public', 'badge_definition');
select tests.rls_enabled('public', 'user_badge');

-- Seed loaded, mirrors the FE catalogs (4).
select is((select count(*) from public.scenario_definition), 4::bigint, 'seed: 4 scenarios');
select is((select count(*) from public.mission_definition), 7::bigint, 'seed: 7 missions');
select is((select count(*) from public.voucher_definition), 5::bigint, 'seed: 5 vouchers');
select is((select count(*) from public.badge_definition), 9::bigint, 'seed: 9 badges');

-- Derived level boundaries (5).
select is(public.level_from_xp(-5), 1, 'level_from_xp(-5) clamps to 1');
select is(public.level_from_xp(99), 1, 'level_from_xp(99) = 1');
select is(public.level_from_xp(100), 2, 'level_from_xp(100) = 2');
select is(public.level_from_xp(300), 3, 'level_from_xp(300) = 3');
select is(public.level_from_xp(1500), 6, 'level_from_xp(1500) = 6');

-- Constraints (7). Seed a valid user for FK-satisfying rows.
select tests.create_user('schema_user');

select throws_ok(
  $$ update public.user_progress set xp = -1 where user_id = tests.get_uid('schema_user') $$,
  '23514', null, 'user_progress.xp >= 0 enforced');

select throws_ok(
  $$ insert into public.mission_completion (user_id, mission_id)
     values (tests.get_uid('schema_user'), 'does-not-exist') $$,
  '23503', null, 'mission_completion FK rejects unknown mission');

insert into public.mission_completion (user_id, mission_id)
  values (tests.get_uid('schema_user'), 'main-kuis');
select throws_ok(
  $$ insert into public.mission_completion (user_id, mission_id)
     values (tests.get_uid('schema_user'), 'main-kuis') $$,
  '23505', null, 'mission_completion unique(user_id, mission_id) enforced');

select throws_ok(
  $$ insert into public.sessions (user_id, scenario_id, started_at, ended_at, trigger, ending_type)
     values (tests.get_uid('schema_user'), 'kredit-macet', now(), now() - interval '1 hour', 'manual', 'good') $$,
  '23514', null, 'sessions.ended_at >= started_at enforced');

select throws_ok(
  $$ insert into public.sessions (user_id, scenario_id, ended_at, trigger)
     values (tests.get_uid('schema_user'), 'kredit-macet', now(), 'manual') $$,
  '23514', null, 'ended session must carry an ending_type');

select throws_ok(
  $$ insert into public.mission_definition (code, kind, redeem_code) values ('x-game', 'game', 'SECRET') $$,
  '23514', null, 'game mission cannot carry a redeem_code');

select throws_ok(
  $$ insert into public.mission_definition (code, kind) values ('x-real', 'reallife') $$,
  '23514', null, 'reallife mission must carry a redeem_code');

select throws_ok(
  $$ insert into public.mission_definition (code, kind, redeem_code) values ('x-blank', 'reallife', '   ') $$,
  '23514', null, 'reallife redeem_code cannot be blank');

-- Display name is truncated to 16 chars at signup (1).
select tests.create_user('longname', '{"name":"ABCDEFGHIJKLMNOPQRST"}'::jsonb);
select is(
  (select char_length(display_name) from public.profiles where id = tests.get_uid('longname')),
  16, 'handle_new_user truncates long display names to 16');

select * from finish();
rollback;
