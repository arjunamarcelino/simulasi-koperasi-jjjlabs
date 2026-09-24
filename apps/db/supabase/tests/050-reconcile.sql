-- One-time reconcile: additive credit, game-mission union only, clamp, idempotency,
-- uid guard. Catalog reward sums (from seed): Σxp = 210 → ceiling 410; Σpoint = 355
-- → ceiling 555.
begin;
select plan(13);

select tests.create_user('rec_a');
select tests.create_user('rec_b');
select tests.create_user('rec_d');

-- normal reconcile: game mission unioned; reallife + unknown codes dropped ------
select tests.login_as('rec_a');
select is((public.reconcile_local_progress(tests.get_uid('rec_a'), 40, 30,
    array['baca-mading', 'kunjungi-kdmp', 'does-not-exist']) ->> 'ok'), 'true',
  'reconcile ok');
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('rec_a')), 40,
  'xp credited additively');
select is((select point from public.user_progress where user_id = tests.get_uid('rec_a')), 30,
  'point credited additively');
select is((select count(*) from public.mission_completion where user_id = tests.get_uid('rec_a')), 1::bigint,
  'only the game mission was unioned (reallife + unknown dropped)');
select is((select mission_id from public.mission_completion where user_id = tests.get_uid('rec_a')), 'baca-mading',
  'the game mission migrated');
select is((select reconciled_at is not null from public.user_progress where user_id = tests.get_uid('rec_a')), true,
  'reconciled_at marker set');

-- idempotent: a second call is a no-op (no double-credit) ----------------------
select tests.login_as('rec_a');
select is((public.reconcile_local_progress(tests.get_uid('rec_a'), 999, 999, array[]::text[]) ->> 'skipped'),
  'already', 'second reconcile is a no-op (skipped)');
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('rec_a')), 40,
  'second reconcile did not double-credit');

-- clamp: an inflated import is capped to the catalog ceiling -------------------
select tests.login_as('rec_b');
select public.reconcile_local_progress(tests.get_uid('rec_b'), 100000000, 100000000, array[]::text[]);
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('rec_b')), 410,
  'inflated xp clamped to ceiling (Σrewards 210 + 200)');
select is((select point from public.user_progress where user_id = tests.get_uid('rec_b')), 555,
  'inflated point clamped to ceiling (Σrewards 355 + 200)');

-- uid mismatch aborts without consuming the marker ----------------------------
select tests.login_as('rec_d');
select is((public.reconcile_local_progress(tests.get_uid('rec_a'), 10, 10, array[]::text[]) ->> 'reason'),
  'uid_mismatch', 'reconcile aborts on uid mismatch');
select tests.login_as_service();
select is((select reconciled_at is null from public.user_progress where user_id = tests.get_uid('rec_d')), true,
  'a mismatched reconcile did not consume the marker');

-- anon cannot call reconcile --------------------------------------------------
select tests.login_as_anon();
select throws_ok(
  $$ select public.reconcile_local_progress('00000000-0000-0000-0000-000000000000'::uuid, 1, 1, array[]::text[]) $$,
  '42501', null, 'anon (no JWT) cannot call reconcile_local_progress');

select * from finish();
rollback;
