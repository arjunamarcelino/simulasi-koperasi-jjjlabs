-- Harden public.submit_quiz (SIM-37 review follow-up). The function documents the
-- contract "bad input returns a structured {ok:false}, never a raw error", but a
-- well-formed element with a KNOWN code and a non-numeric `choice`
-- (e.g. {"code":"q1","choice":"abc"} / true / []) reaches `jsonb_to_recordset(... choice int)`,
-- whose int cast RAISEs → an unhandled 500. Add an early guard (matching the existing
-- null / non-array / >10 / non-object-element guards) that rejects any element whose
-- present `choice` is not a JSON number. CREATE OR REPLACE — body identical to the
-- original (20260924100100_quiz.sql) except the new guard block.

create or replace function public.submit_quiz(p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_new int;
  v_prior text[];
  v_totals record;
  v_results jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if jsonb_array_length(p_answers) > 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  -- Every element must be an object {code, choice}; guard before jsonb_to_recordset,
  -- which raises (500) on a non-object element like `["foo"]`.
  if exists (select 1 from jsonb_array_elements(p_answers) e where jsonb_typeof(e) <> 'object') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- Each element's `choice` (when present) must be a JSON number; jsonb_to_recordset
  -- casts it to int and RAISEs (500) on e.g. {"code":"q1","choice":"abc"}. Guard first
  -- so bad input returns a structured {ok:false} per the contract. A missing choice is
  -- allowed (→ NULL, graded incorrect) exactly as before.
  if exists (
    select 1 from jsonb_array_elements(p_answers) e
    where (e ? 'choice') and jsonb_typeof(e -> 'choice') <> 'number'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Reject any submitted code that is not a real question.
  if exists (
    select 1
    from (
      select distinct a.code
      from jsonb_to_recordset(p_answers) as a(code text, choice int)
      where a.code is not null
    ) s
    where not exists (select 1 from public.quiz_definition q where q.code = s.code)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_question');
  end if;

  -- Which submitted codes were ALREADY completed (before this call) — for the flag.
  select coalesce(array_agg(qc.question_code), '{}') into v_prior
  from public.quiz_completion qc
  where qc.user_id = v_uid
    and qc.question_code in (
      select distinct a.code
      from jsonb_to_recordset(p_answers) as a(code text, choice int)
      where a.code is not null
    );

  -- Credit only newly-correct questions. Dedupe a repeated code deterministically,
  -- preferring the correct choice (`order by … desc`) so a duplicate can never credit
  -- or not arbitrarily; rowcount is the exactly-once new-credit count.
  with graded as (
    select distinct on (a.code) a.code, (a.choice = q.correct_index) as correct
    from jsonb_to_recordset(p_answers) as a(code text, choice int)
    join public.quiz_definition q on q.code = a.code
    where a.code is not null
    order by a.code, (a.choice = q.correct_index) desc
  ),
  ins as (
    insert into public.quiz_completion (user_id, question_code)
    select v_uid, code from graded where correct
    on conflict (user_id, question_code) do nothing
    returning question_code
  )
  select count(*) into v_new from ins;

  -- Reuse add_rewards' returned totals when crediting; else read the current row.
  if v_new > 0 then
    select xp, point into v_totals from public.add_rewards(v_new * 10, v_new * 10);
  else
    select up.xp, up.point into v_totals from public.user_progress up where up.user_id = v_uid;
  end if;

  -- Results use the SAME deterministic dedupe, so credit and display never disagree.
  -- already_credited = the question was completed BEFORE this call, independent of the
  -- current answer's correctness.
  select jsonb_agg(jsonb_build_object(
           'code', g.code,
           'correct', g.correct,
           'explanation', g.explanation,
           'already_credited', (g.code = any(v_prior))
         ) order by g.code)
    into v_results
  from (
    select distinct on (a.code) a.code,
           (a.choice = q.correct_index) as correct,
           q.explanation
    from jsonb_to_recordset(p_answers) as a(code text, choice int)
    join public.quiz_definition q on q.code = a.code
    where a.code is not null
    order by a.code, (a.choice = q.correct_index) desc
  ) g;

  return jsonb_build_object(
    'ok', true,
    'awarded', jsonb_build_object('xp', v_new * 10, 'point', v_new * 10),
    'totals', jsonb_build_object('xp', coalesce(v_totals.xp, 0), 'point', coalesce(v_totals.point, 0)),
    'results', coalesce(v_results, '[]'::jsonb)
  );
end;
$$;
-- Preserve the original privilege set (CREATE OR REPLACE keeps grants, but re-assert
-- to be explicit): anon is granted EXECUTE via a default privilege, so revoke it too.
revoke execute on function public.submit_quiz(jsonb) from public, anon;
grant execute on function public.submit_quiz(jsonb) to authenticated;
