-- Quiz — server-authoritative grading. The answer key (correct_index) lives in a
-- base table the client CANNOT read; questions/options are exposed through a plain
-- owner-privileged view (mirror of mission_catalog — do NOT set security_invoker, or
-- the caller, having no privilege on the base table, reads nothing). Reward amounts
-- are owned by submit_quiz, and each question credits at most once per user.

create table public.quiz_definition (
  code text primary key,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  -- correct_index must point at a real option; the `jsonb_typeof <> array` disjunct
  -- keeps this CHECK from raising when a bad options value is already rejected above.
  correct_index int not null
    check (correct_index >= 0
           and (jsonb_typeof(options) <> 'array' or correct_index < jsonb_array_length(options))),
  explanation text,                               -- revealed post-answer via submit_quiz, never in the catalog view
  sort_order int not null default 0
);

-- Hide the answer key (and explanation) from the client. Supabase auto-grants new
-- public tables to anon/authenticated, so REVOKE explicitly; RLS is enabled with no
-- policy so even a mis-grant reads nothing. The catalog view is PLAIN (owner-privileged):
-- a "security_definer_view" linter warning here is expected and intended.
alter table public.quiz_definition enable row level security;
revoke all on table public.quiz_definition from anon, authenticated;

create view public.quiz_catalog as
  select code, prompt, options, sort_order
  from public.quiz_definition;
grant select on public.quiz_catalog to anon, authenticated;

-- Per-question, credit-once ledger. PK (user_id, question_code) — user_id leading,
-- so per-user hydrate and the submit_quiz conflict target are both index-covered;
-- add no redundant (user_id) index. Writes go only through submit_quiz (definer).
create table public.quiz_completion (
  user_id uuid not null references public.profiles on delete cascade,
  question_code text not null references public.quiz_definition (code),
  first_correct_at timestamptz not null default now(),
  primary key (user_id, question_code)
);
alter table public.quiz_completion enable row level security;
create policy "quiz_completion: owner select" on public.quiz_completion
  for select to authenticated using ((select auth.uid()) = user_id);

-- Grade a submission server-side and credit only NEWLY-correct questions. The client
-- submits [{code, choice}]; the answer key never leaves the server. Reward constants
-- (10 xp + 10 point per newly-correct question) are server-owned so points/XP cannot
-- be forged (the FE no longer knows them). The `insert … on conflict do nothing
-- returning` makes crediting exactly-once and race/double-submit safe. The return
-- deliberately omits correct_index so a caller cannot enumerate the answer key.
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
-- Revoke from anon explicitly: this Supabase setup grants EXECUTE to anon via a
-- default privilege (not via PUBLIC), so `from public` alone would not block it.
revoke execute on function public.submit_quiz(jsonb) from public, anon;
grant execute on function public.submit_quiz(jsonb) to authenticated;
