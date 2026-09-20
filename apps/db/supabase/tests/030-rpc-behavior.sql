-- RPC behavior: the atomicity/idempotency guarantees the RPCs exist to provide.
begin;
select plan(19);

select tests.create_user('claimer');
select tests.create_user('spender');
select tests.create_user('buyer');
select tests.create_user('player');
select tests.create_user('other');

-- claim_mission ---------------------------------------------------------------
select tests.login_as('claimer');
select is((public.claim_mission('main-kuis') ->> 'ok'), 'true', 'first claim succeeds');
select is((public.claim_mission('main-kuis') ->> 'reason'), 'already', 'second claim is idempotent');

select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('claimer')), 20,
  'reward credited exactly once (xp = 20)');

select tests.login_as('claimer');
select is((public.claim_mission('kunjungi-kdmp', 'WRONG') ->> 'reason'), 'wrong-code',
  'reallife claim rejects wrong code');
select is((public.claim_mission('kunjungi-kdmp', '  kdmp2026 ') ->> 'ok'), 'true',
  'reallife claim accepts code (trim + case-insensitive)');
select throws_ok(
  $$ select public.add_rewards(999, 999) $$,
  '42501', null, 'add_rewards is not client-callable (private helper)');

-- redeem_voucher --------------------------------------------------------------
select tests.login_as_service();
update public.user_progress set point = 100 where user_id = tests.get_uid('spender');
select tests.login_as('spender');
select is((public.redeem_voucher('belanja-5k') ->> 'ok'), 'true', 'redeem with sufficient balance');
select tests.login_as_service();
select is((select point from public.user_progress where user_id = tests.get_uid('spender')), 50,
  'balance debited by voucher cost (100 - 50)');

update public.user_progress set point = 10 where user_id = tests.get_uid('spender');
select tests.login_as('spender');
select is((public.redeem_voucher('sembako') ->> 'reason'), 'insufficient',
  'redeem rejected when balance < cost');
select tests.login_as_service();
select is((select point from public.user_progress where user_id = tests.get_uid('spender')), 10,
  'balance unchanged after insufficient redeem');

-- repeatable redemption mints distinct codes
update public.user_progress set point = 1000 where user_id = tests.get_uid('buyer');
select tests.login_as('buyer');
select public.redeem_voucher('belanja-5k');
select public.redeem_voucher('belanja-5k');
select tests.login_as_service();
select is((select count(*) from public.voucher_redemption where user_id = tests.get_uid('buyer')),
  2::bigint, 'voucher redemption is repeatable (2 rows)');
select is((select count(distinct minted_code) from public.voucher_redemption where user_id = tests.get_uid('buyer')),
  2::bigint, 'each redemption mints a distinct code');

-- record_session_result -------------------------------------------------------
select tests.login_as('player');
insert into public.sessions (id, user_id, scenario_id)
  values ('11111111-1111-1111-1111-111111111111', tests.get_uid('player'), 'kredit-macet');
insert into public.sessions (id, user_id, scenario_id)
  values ('22222222-2222-2222-2222-222222222222', tests.get_uid('player'), 'kredit-macet');
select is(
  (public.record_session_result('11111111-1111-1111-1111-111111111111'::uuid, 'manual', 'good') ->> 'ok'),
  'true', 'record_session_result finalizes an open owned session');
select is(
  (public.record_session_result('11111111-1111-1111-1111-111111111111'::uuid, 'manual', 'good') ->> 'reason'),
  'not_found_or_closed', 'cannot finalize an already-closed session');
select tests.login_as('other');
select is(
  (public.record_session_result('22222222-2222-2222-2222-222222222222'::uuid, 'manual', 'good') ->> 'reason'),
  'not_found_or_closed', 'cannot finalize another user''s session');
select is(
  (public.record_session_result('22222222-2222-2222-2222-222222222222'::uuid, 'BOGUS', 'good') ->> 'reason'),
  'invalid', 'record_session_result rejects an invalid trigger with a structured reason');

-- badges (plain insert, idempotent via unique) --------------------------------
select tests.login_as('claimer');
select lives_ok(
  $$ insert into public.user_badge (user_id, badge_id) values (tests.get_uid('claimer'), 'penjelajah') $$,
  'owner can award a badge to self');
select throws_ok(
  $$ insert into public.user_badge (user_id, badge_id) values (tests.get_uid('claimer'), 'penjelajah') $$,
  '23505', null, 'badge award is idempotent (unique user_id, badge_id)');

-- leaderboard (bypasses owner-only RLS) ---------------------------------------
select tests.login_as_anon();
select ok((select count(*) from public.leaderboard(20)) >= 1, 'leaderboard returns ranked rows to anon');

select * from finish();
rollback;
