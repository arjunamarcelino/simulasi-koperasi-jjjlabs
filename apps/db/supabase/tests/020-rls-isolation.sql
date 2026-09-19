-- RLS isolation: owners see their own rows, non-owners see nothing, writes can't
-- forge another owner, catalogs are public-read-only, and secret codes stay hidden.
begin;
select plan(11);

select tests.create_user('u1');
select tests.create_user('u2');

-- Seed rows owned by u1 (as service role, bypassing RLS).
select tests.login_as_service();
insert into public.sessions (user_id, scenario_id) values (tests.get_uid('u1'), 'kredit-macet');
insert into public.user_badge (user_id, badge_id) values (tests.get_uid('u1'), 'hartawan');

-- Positive: u1 sees own rows.
select tests.login_as('u1');
select is((select count(*) from public.user_progress), 1::bigint, 'u1 sees own progress row');
select is((select count(*) from public.sessions), 1::bigint, 'u1 sees own session');

-- Negative: u2 sees none of u1's rows.
select tests.login_as('u2');
select is((select count(*) from public.sessions where user_id = tests.get_uid('u1')), 0::bigint,
  'u2 cannot see u1 sessions');
select is((select count(*) from public.user_badge where user_id = tests.get_uid('u1')), 0::bigint,
  'u2 cannot see u1 badges');

-- Negative: u1 cannot insert a row owned by u2 (WITH CHECK).
select tests.login_as('u1');
select throws_ok(
  $$ insert into public.sessions (user_id, scenario_id) values (tests.get_uid('u2'), 'kredit-macet') $$,
  '42501', null, 'cannot insert a session owned by another user');
select throws_ok(
  $$ insert into public.user_badge (user_id, badge_id) values (tests.get_uid('u2'), 'penjelajah') $$,
  '42501', null, 'cannot insert a badge owned by another user');

-- Catalogs are public-read for anonymous guests.
select tests.login_as_anon();
select is((select count(*) from public.scenario_definition), 4::bigint, 'anon reads scenario catalog');
select is((select count(*) from public.mission_catalog), 7::bigint, 'anon reads mission_catalog view');

-- Catalog writes are denied; the mission_definition base table is not client-readable.
select tests.login_as('u1');
select throws_ok(
  $$ insert into public.scenario_definition (code, title, status) values ('x', 'X', 'AVAILABLE') $$,
  '42501', null, 'authenticated cannot write catalog tables');
select throws_ok(
  $$ select 1 from public.mission_definition $$,
  '42501', null, 'authenticated cannot read mission_definition (secret codes)');

-- The public view never exposes redeem_code.
select hasnt_column('public', 'mission_catalog', 'redeem_code', 'mission_catalog hides redeem_code');

select * from finish();
rollback;
