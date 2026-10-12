-- admin.list_quiz / upsert_quiz_question / delete_quiz_question (SIM-18).
--
-- Fixtures built INLINE inside begin/rollback (session user = superuser postgres, so direct
-- inserts bypass RLS). Mutating functions are invoked ONCE and stashed in a temp table;
-- pure-rejection calls (which mutate nothing) are called inline. Grant matrix asserted via
-- has_*_privilege. The error-contract invariant is proven by asserting that every expected
-- rejection is a STRUCTURED RETURN ({ok:false, reason}) — never a raised exception.
begin;
select plan(40);

-- The test DB is seeded (seed.sql loads 20 quiz questions). Clear quiz data inside this
-- rolled-back txn so assertions on absolute counts/ordering are hermetic.
delete from public.quiz_completion;
delete from public.quiz_definition;

-- ── fixtures: two seeded questions; q1 has a completion (undeletable per D5) ───────────────
insert into public.quiz_definition (code, prompt, options, correct_index, explanation, sort_order) values
  ('q1', 'Prompt 1', '["a","b","c"]'::jsonb, 2, 'because a', 0),
  ('q2', 'Prompt 2', '["a","b"]'::jsonb,     0, null,        1);
select tests.create_user('u1', '{"name":"Budi"}');
insert into public.quiz_completion (user_id, question_code) values (tests.get_uid('u1'), 'q1');

-- ── migration shape ────────────────────────────────────────────────────────────────────────
select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='quiz_definition' and column_name='updated_at'),
  'NO', 'updated_at added NOT NULL');
select is(
  (select count(*)::int from pg_indexes
    where schemaname='public' and indexname='quiz_completion_question_code_idx'),
  1, 'FK-covering index quiz_completion(question_code) exists');

-- ── admin.list_quiz: exposes the hidden answer key, ordered by sort_order, code ────────────
select is((admin.list_quiz()->>'ok')::boolean, true, 'list_quiz: ok');
select is(jsonb_array_length(admin.list_quiz()->'rows'), 2, 'list_quiz: 2 rows');
select is((admin.list_quiz() #>> '{rows,0,code}'), 'q1', 'list_quiz: rows[0] = q1 (sort_order 0)');
select is((admin.list_quiz() #>> '{rows,0,correct_index}')::int, 2, 'list_quiz: exposes correct_index (hidden from catalog)');
select is((admin.list_quiz() #>> '{rows,1,code}'), 'q2', 'list_quiz: rows[1] = q2');

-- ── create (p_prev_updated_at IS NULL) ─────────────────────────────────────────────────────
create temporary table up_new as
  select admin.upsert_quiz_question('q3','Prompt 3','["a","b","c"]'::jsonb,1,'expl',5,null) as r;
select is((select (r->>'ok')::boolean from up_new), true, 'create q3: ok');
select is(jsonb_array_length(admin.list_quiz()->'rows'), 3, 'create q3: list now 3 rows');

-- create with an existing code → duplicate_code (no RAISE)
select is((admin.upsert_quiz_question('q1','x','["a","b"]'::jsonb,0,null,0,null)->>'ok')::boolean, false,
  'create duplicate code: ok=false');
select is((admin.upsert_quiz_question('q1','x','["a","b"]'::jsonb,0,null,0,null)->>'reason'), 'duplicate_code',
  'create duplicate code: reason=duplicate_code');

-- ── edit (CAS: p_prev_updated_at IS NOT NULL, must match) ──────────────────────────────────
create temporary table up_edit as
  select admin.upsert_quiz_question('q2','Edited','["a","b","c","d"]'::jsonb,2,'e2',1,
    (select updated_at from public.quiz_definition where code='q2')) as r;
select is((select (r->>'ok')::boolean from up_edit), true, 'edit q2: ok');
select is((select prompt from public.quiz_definition where code='q2'), 'Edited', 'edit q2: prompt updated');
select is((select jsonb_array_length(options) from public.quiz_definition where code='q2'), 4, 'edit q2: options grown to 4');

-- edit with a stale CAS token → stale_write
select is((admin.upsert_quiz_question('q2','Nope','["a","b"]'::jsonb,0,null,0,'epoch'::timestamptz)->>'reason'),
  'stale_write', 'edit q2 stale token: reason=stale_write');
-- edit a code that does not exist → not_found (the CAS token makes this an EDIT)
select is((admin.upsert_quiz_question('nope','x','["a","b"]'::jsonb,0,null,0, now())->>'reason'),
  'not_found', 'edit unknown code: reason=not_found');

-- ── validation guards return structured reasons (never RAISE the table CHECK into a 503) ──
select is((admin.upsert_quiz_question('q9','p','[]'::jsonb,0,null,0,null)->>'reason'), 'options_len',
  'empty options: reason=options_len');
select is((admin.upsert_quiz_question('q9','p','["a","b"]'::jsonb,5,null,0,null)->>'reason'), 'correct_index_range',
  'correct_index out of range: reason=correct_index_range');
select is((admin.upsert_quiz_question('q9','p','["a","b","c","d","e"]'::jsonb,0,null,0,null)->>'reason'), 'options_len',
  '5 options: reason=options_len (cap 4)');
select is((admin.upsert_quiz_question('q9','p','["a","b"]'::jsonb,0,null,-1,null)->>'reason'), 'sort_order_negative',
  'negative sort_order: reason=sort_order_negative');
select is((admin.upsert_quiz_question('','p','["a","b"]'::jsonb,0,null,0,null)->>'reason'), 'empty_code',
  'empty code: reason=empty_code');

-- boundaries: options length 2 and 4 accepted
select is((admin.upsert_quiz_question('qlen2','p','["a","b"]'::jsonb,0,null,10,null)->>'ok')::boolean, true,
  'options length 2 accepted');
select is((admin.upsert_quiz_question('qlen4','p','["a","b","c","d"]'::jsonb,3,null,11,null)->>'ok')::boolean, true,
  'options length 4 accepted');

-- ── delete: soft-block answered questions (TOCTOU-safe via EXCEPTION handler) ──────────────
create temporary table del_q1 as select admin.delete_quiz_question('q1') as r;
select is((select (r->>'ok')::boolean from del_q1), false, 'delete q1 (answered): ok=false');
select is((select (r->>'reason') from del_q1), 'has_completions', 'delete q1: reason=has_completions (no raw 23503)');
select is((select count(*)::int from public.quiz_definition where code='q1'), 1, 'delete q1: row survives the block');

select is((admin.delete_quiz_question('zzz')->>'reason'), 'not_found', 'delete unknown: reason=not_found');

create temporary table del_q3 as select admin.delete_quiz_question('q3') as r;
select is((select (r->>'deleted')::boolean from del_q3), true, 'delete q3 (no completion): deleted=true');
select is((select count(*)::int from public.quiz_definition where code='q3'), 0, 'delete q3: row removed');

-- ── answer key stays hidden: quiz_catalog projects exactly {code,prompt,options,sort_order} ──
select is((select count(*)::int from information_schema.columns
             where table_schema='public' and table_name='quiz_catalog'), 4,
  'quiz_catalog has exactly 4 columns');
select is((select count(*)::int from information_schema.columns
             where table_schema='public' and table_name='quiz_catalog'
               and column_name in ('correct_index','explanation','updated_at')), 0,
  'quiz_catalog leaks no correct_index/explanation/updated_at');
select is((select bool_and(column_name in ('code','prompt','options','sort_order'))
             from information_schema.columns
             where table_schema='public' and table_name='quiz_catalog'), true,
  'quiz_catalog columns are the expected set');

-- ── grant matrix ─────────────────────────────────────────────────────────────────────────
select is(has_function_privilege('metrics_reader', 'admin.list_quiz()', 'EXECUTE'), true,
  'metrics_reader can EXECUTE list_quiz');
select is(has_function_privilege('metrics_reader',
  'admin.upsert_quiz_question(text,text,jsonb,int,text,int,timestamptz)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE upsert_quiz_question');
select is(has_function_privilege('metrics_reader', 'admin.delete_quiz_question(text)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE delete_quiz_question');
select is(has_function_privilege('public',
  'admin.upsert_quiz_question(text,text,jsonb,int,text,int,timestamptz)', 'EXECUTE'), false,
  'public cannot EXECUTE upsert_quiz_question');
select is(has_function_privilege('anon', 'admin.delete_quiz_question(text)', 'EXECUTE'), false,
  'anon cannot EXECUTE delete_quiz_question');
select is(has_function_privilege('authenticated', 'admin.list_quiz()', 'EXECUTE'), false,
  'authenticated cannot EXECUTE list_quiz');
select is(has_table_privilege('metrics_reader', 'public.quiz_definition', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on quiz_definition');
select is(has_schema_privilege('metrics_reader', 'admin', 'USAGE'), true,
  'metrics_reader has USAGE on admin');

select * from finish();
rollback;
