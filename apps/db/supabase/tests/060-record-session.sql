-- record_session: atomic insert-and-finalize in one txn (PR #22 review P2-1/P2-2/P3-3).
begin;
select plan(15);

select tests.create_user('rsplayer');

-- happy path: one call inserts a fully-finalized row (no observable OPEN phase)
select tests.login_as('rsplayer');
select is(
  (public.record_session(p_scenario_id => 'kredit-macet', p_trigger => 'manual', p_ending_type => 'good') ->> 'ok'),
  'true', 'record_session finalizes in one call');

select tests.login_as_service();
select is(
  (select count(*) from public.sessions where user_id = tests.get_uid('rsplayer') and ended_at is not null),
  1::bigint, 'exactly one finalized row created, owned by the caller');
select ok(
  (select bool_and(ended_at is not null and trigger is not null and ending_type is not null)
     from public.sessions where user_id = tests.get_uid('rsplayer')),
  'no OPEN/orphan row — the row is fully finalized');

-- clamp: a future client start time must not trip the time-order CHECK (P2-2)
select tests.login_as('rsplayer');
select is(
  (public.record_session(p_scenario_id => 'kredit-macet', p_trigger => 'manual',
     p_ending_type => 'good', p_started_at => now() + interval '1 hour') ->> 'ok'),
  'true', 'future p_started_at is clamped (no CHECK violation)');
select tests.login_as_service();
select ok(
  (select bool_and(ended_at >= started_at) from public.sessions where user_id = tests.get_uid('rsplayer')),
  'started_at <= ended_at for every row (clamp holds)');

-- structured failures — never a raw error
select tests.login_as('rsplayer');
select is(
  (public.record_session(p_scenario_id => 'kredit-macet', p_trigger => 'BOGUS', p_ending_type => 'good') ->> 'reason'),
  'invalid', 'invalid trigger → {ok:false, reason:invalid}');
select is(
  (public.record_session(p_scenario_id => 'kredit-macet', p_trigger => 'manual',
     p_ending_type => 'good', p_feedback => repeat('x', 5000)) ->> 'reason'),
  'too_large', 'oversized feedback → {ok:false, reason:too_large}');
select is(
  (public.record_session(p_scenario_id => 'does-not-exist', p_trigger => 'manual', p_ending_type => 'good') ->> 'reason'),
  'invalid', 'unknown scenario_id (FK) → {ok:false, reason:invalid}');

-- personal feedback (ICA values): values / progress / next_step persisted as sent
select tests.login_as('rsplayer');
select is(
  (public.record_session(p_scenario_id => 'keanggotaan-fiktif', p_trigger => 'manual',
     p_ending_type => 'good',
     p_values => '{"kepedulian": {"status": "TERCERMIN", "evidence": "Bertanya dulu.", "trend": "MENGUAT"}}'::jsonb,
     p_progress => 'Saran sesi lalu Anda jalankan.',
     p_next_step => 'Tetap santun saat ditekan.') ->> 'ok'),
  'true', 'record_session accepts the personal-feedback fields');
select tests.login_as_service();
select is(
  (select (values_json -> 'kepedulian' ->> 'status') || '|' || progress_feedback || '|' || next_step
     from public.sessions
    where user_id = tests.get_uid('rsplayer') and scenario_id = 'keanggotaan-fiktif'),
  'TERCERMIN|Saran sesi lalu Anda jalankan.|Tetap santun saat ditekan.',
  'values_json, progress_feedback, next_step are persisted');
select ok(
  (select bool_and(values_json = '{}'::jsonb and progress_feedback is null and next_step is null)
     from public.sessions
    where user_id = tests.get_uid('rsplayer') and scenario_id = 'kredit-macet'),
  'omitted personal-feedback params default to empty (older callers unaffected)');

select tests.login_as('rsplayer');
select is(
  (public.record_session(p_scenario_id => 'kredit-macet', p_trigger => 'manual',
     p_ending_type => 'good', p_values => jsonb_build_object('k', repeat('x', 5000))) ->> 'reason'),
  'too_large', 'oversized values → {ok:false, reason:too_large}');
select is(
  (public.record_session(p_scenario_id => 'kredit-macet', p_trigger => 'manual',
     p_ending_type => 'good', p_progress => repeat('x', 2001)) ->> 'reason'),
  'too_large', 'oversized progress_feedback → {ok:false, reason:too_large}');
select is(
  (public.record_session(p_scenario_id => 'kredit-macet', p_trigger => 'manual',
     p_ending_type => 'good', p_next_step => repeat('x', 501)) ->> 'reason'),
  'too_large', 'oversized next_step → {ok:false, reason:too_large}');

-- anon (no JWT) cannot execute — EXECUTE revoked
select tests.login_as_anon();
select throws_ok(
  $$ select public.record_session('kredit-macet', 'manual', 'good') $$,
  '42501', null, 'record_session is not callable by anon (EXECUTE revoked)');

select * from finish();
rollback;
