-- One-time reconcile: xp-only additive credit (point NOT migrated), game-mission
-- union only, clamp, idempotency, uid guard, no-row self-heal. Catalog xp ceiling
-- (from seed): Σreward_xp = 210 + quiz 20×10 = 200 → 410.
begin;
select plan(15);

select tests.create_user('rec_a');
select tests.create_user('rec_b');
select tests.create_user('rec_d');
select tests.create_user('rec_e');

-- normal reconcile: xp credited, point NOT migrated; game mission unioned -------
select tests.login_as('rec_a');
select is((public.reconcile_local_progress(tests.get_uid('rec_a'), 40,
    array['baca-mading', 'kunjungi-kdmp', 'does-not-exist']) ->> 'ok'), 'true',
  'reconcile ok');
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('rec_a')), 40,
  'xp credited additively');
select is((select point from public.user_progress where user_id = tests.get_uid('rec_a')), 0,
  'point is NOT migrated (stays 0)');
select is((select count(*) from public.mission_completion where user_id = tests.get_uid('rec_a')), 1::bigint,
  'only the game mission was unioned (reallife + unknown dropped)');
select is((select mission_id from public.mission_completion where user_id = tests.get_uid('rec_a')), 'baca-mading',
  'the game mission migrated');
select is((select reconciled_at is not null from public.user_progress where user_id = tests.get_uid('rec_a')), true,
  'reconciled_at marker set');

-- idempotent: a second call is a no-op (no double-credit) ----------------------
select tests.login_as('rec_a');
select is((public.reconcile_local_progress(tests.get_uid('rec_a'), 999, array[]::text[]) ->> 'skipped'),
  'already', 'second reconcile is a no-op (skipped)');
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('rec_a')), 40,
  'second reconcile did not double-credit');

-- clamp: an inflated xp import is capped to the catalog ceiling ----------------
select tests.login_as('rec_b');
select public.reconcile_local_progress(tests.get_uid('rec_b'), 100000000, array[]::text[]);
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('rec_b')), 410,
  'inflated xp clamped to catalog ceiling (Σrewards 210 + quiz 200)');
select is((select point from public.user_progress where user_id = tests.get_uid('rec_b')), 0,
  'clamped reconcile still migrates no point');

-- uid mismatch aborts without consuming the marker ----------------------------
select tests.login_as('rec_d');
select is((public.reconcile_local_progress(tests.get_uid('rec_a'), 10, array[]::text[]) ->> 'reason'),
  'uid_mismatch', 'reconcile aborts on uid mismatch');
select tests.login_as_service();
select is((select reconciled_at is null from public.user_progress where user_id = tests.get_uid('rec_d')), true,
  'a mismatched reconcile did not consume the marker');

-- no-row self-heal: a missing user_progress row is provisioned + credited, not skipped
select tests.login_as_service();
delete from public.user_progress where user_id = tests.get_uid('rec_e');
select tests.login_as('rec_e');
select is((public.reconcile_local_progress(tests.get_uid('rec_e'), 25, array[]::text[]) ->> 'ok'),
  'true', 'reconcile self-heals a missing progress row (does not falsely skip)');
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('rec_e')), 25,
  'self-healed reconcile credited xp (no silent loss)');

-- anon cannot call reconcile --------------------------------------------------
select tests.login_as_anon();
select throws_ok(
  $$ select public.reconcile_local_progress('00000000-0000-0000-0000-000000000000'::uuid, 1, array[]::text[]) $$,
  '42501', null, 'anon (no JWT) cannot call reconcile_local_progress');

select * from finish();
rollback;
