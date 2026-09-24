-- Quiz: answer-key secrecy, server-authoritative grading, per-question credit-once.
begin;
select plan(26);

select tests.create_user('quiz_a');
select tests.create_user('quiz_b');
select tests.create_user('quiz_c');

-- schema / secrecy ------------------------------------------------------------
select has_table('public', 'quiz_definition', 'quiz_definition exists');
select has_view('public', 'quiz_catalog', 'quiz_catalog view exists');
select hasnt_column('public', 'quiz_catalog', 'correct_index', 'quiz_catalog hides the answer key');
select hasnt_column('public', 'quiz_catalog', 'explanation', 'quiz_catalog hides explanations');

select tests.login_as_anon();
select is((select count(*) from public.quiz_catalog), 20::bigint, 'anon reads quiz_catalog (20 questions)');
select throws_ok($$ select 1 from public.quiz_definition $$, '42501', null,
  'cannot read quiz_definition base table (answer key hidden)');
select throws_ok($$ select public.submit_quiz('[]'::jsonb) $$, '42501', null,
  'anon (no JWT) cannot call submit_quiz');

-- grading + credit ------------------------------------------------------------
select tests.login_as('quiz_a');
select is((public.submit_quiz('[{"code":"q01","choice":0},{"code":"q02","choice":1}]'::jsonb) ->> 'ok'),
  'true', 'submit_quiz ok for correct answers');
select is((public.submit_quiz('[{"code":"q03","choice":1}]'::jsonb) -> 'awarded' ->> 'xp'),
  '10', 'a newly-correct question awards 10 xp');
select tests.login_as_service();
select is((select xp from public.user_progress where user_id = tests.get_uid('quiz_a')), 30,
  'quiz xp credited exactly (q01+q02+q03 = 30)');

-- replay is credit-once -------------------------------------------------------
select tests.login_as('quiz_a');
select is((public.submit_quiz('[{"code":"q01","choice":0}]'::jsonb) -> 'awarded' ->> 'xp'),
  '0', 'replaying an already-correct question awards 0');
select is((public.submit_quiz('[{"code":"q01","choice":0}]'::jsonb) -> 'results' -> 0 ->> 'already_credited'),
  'true', 'replay marks already_credited');

-- partial / wrong / answer-key never returned ---------------------------------
select tests.login_as('quiz_b');
select is((public.submit_quiz('[{"code":"q01","choice":0},{"code":"q02","choice":0}]'::jsonb) -> 'awarded' ->> 'xp'),
  '10', 'partial: only the correct answer credits (q01 right, q02 wrong)');
select is((public.submit_quiz('[{"code":"q02","choice":3}]'::jsonb) -> 'results' -> 0 ->> 'correct'),
  'false', 'out-of-range/wrong choice grades incorrect');
select ok(not ((public.submit_quiz('[{"code":"q04","choice":0}]'::jsonb) -> 'results' -> 0) ? 'correct_index'),
  'submit_quiz return never carries correct_index');

-- duplicate code in one payload credits once ----------------------------------
select tests.login_as('quiz_c');
select is((public.submit_quiz('[{"code":"q05","choice":0},{"code":"q05","choice":0}]'::jsonb) -> 'awarded' ->> 'xp'),
  '10', 'duplicate code in payload credits once');

-- negatives -------------------------------------------------------------------
select is((public.submit_quiz('[{"code":"nope","choice":0}]'::jsonb) ->> 'reason'),
  'unknown_question', 'unknown question code rejected');
select is((public.submit_quiz('[{"code":"q01","choice":0},{"code":"q02","choice":0},{"code":"q03","choice":0},{"code":"q04","choice":0},{"code":"q05","choice":0},{"code":"q06","choice":0},{"code":"q07","choice":0},{"code":"q08","choice":0},{"code":"q09","choice":0},{"code":"q10","choice":0},{"code":"q11","choice":0}]'::jsonb) ->> 'reason'),
  'too_many', 'payload longer than 10 rejected');
select is((public.submit_quiz('[]'::jsonb) -> 'awarded' ->> 'xp'), '0', 'empty submission awards 0');
select is((public.submit_quiz('"nope"'::jsonb) ->> 'reason'), 'invalid', 'non-array payload rejected');

-- get_my_progress + sync_badges ----------------------------------------------
select tests.login_as('quiz_a');
select is((public.get_my_progress() -> 'progress' ->> 'xp'), '30', 'get_my_progress returns own xp');
select lives_ok($$ select public.sync_badges(array['penjelajah']) $$, 'sync_badges inserts a badge');
select lives_ok($$ select public.sync_badges(array['penjelajah']) $$, 'sync_badges is idempotent on repeat');
select lives_ok($$ select public.sync_badges(array['not-a-badge']) $$, 'sync_badges drops unknown badge codes');
select is((public.get_my_progress() -> 'badges' ->> 0), 'penjelajah', 'get_my_progress lists the earned badge');
select is(jsonb_array_length(public.get_my_progress() -> 'badges'), 1, 'unknown badge code was not inserted');

select * from finish();
rollback;
