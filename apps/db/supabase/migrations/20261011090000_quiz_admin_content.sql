-- Admin content management for quiz (SIM-18). Adds a RUNTIME write path to
-- public.quiz_definition (previously written only by the generated seed) plus an
-- admin-only READ that exposes the hidden answer key for editing. Mirrors the SIM-17
-- leaderboard pattern: admin.* SECURITY DEFINER functions, owner postgres, EXECUTE
-- granted ONLY to metrics_reader; the backend enforces require_role('admin').
--
-- Credential blast radius (as SIM-17): metrics_reader now also writes/deletes quiz
-- content through these postgres-owned functions. It holds NO direct table privilege;
-- a leaked METRICS_DB_URL enables admin-gated quiz edits. require_role('admin') is the
-- control. INVARIANT: the `admin` schema must NEVER be added to PostgREST's exposed
-- schemas, and these migrations must NOT touch public.quiz_catalog (the answer key must
-- stay hidden from anon/authenticated).
--
-- Error contract (load-bearing): the backend's metrics_db._call_definer turns ANY raised
-- exception into a 503. So every EXPECTED outcome is a STRUCTURED RETURN ({ok, reason, …}),
-- never a RAISE — the FastAPI route maps reason → HTTP status (404/409/422). RAISE is
-- reserved for true invariants (a bug), which correctly surface as 503.

-- ── updated_at: minimal audit + optimistic-concurrency (compare-and-swap) token ──────────
-- Defaulted now() so the add is safe/fast on the small existing table and existing rows get
-- a value. The generated seed's `on conflict do update` set-list intentionally OMITS this
-- column, so a re-seed does not bump it; only admin.upsert_quiz_question sets it.
alter table public.quiz_definition
  add column if not exists updated_at timestamptz not null default now();

-- ── FK-covering index for the delete soft-block + Postgres's own FK enforcement ──────────
-- public.quiz_completion.question_code references quiz_definition(code). The PK
-- (user_id, question_code) leads with user_id, so a lookup/enforcement by question_code
-- alone would seq-scan the one table that grows with play. Mirrors the SIM-17
-- leaderboard_entries_user_id_idx rationale.
create index if not exists quiz_completion_question_code_idx
  on public.quiz_completion (question_code);

-- ── admin read: full rows INCLUDING the hidden correct_index + explanation ───────────────
-- The client reads public.quiz_catalog (which omits the answer key); admins must edit it,
-- so this definer read returns the full row. STABLE; one jsonb round-trip; deterministic
-- order so the admin table render is stable.
create or replace function admin.list_quiz()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', q.code,
               'prompt', q.prompt,
               'options', q.options,
               'correct_index', q.correct_index,
               'explanation', q.explanation,
               'sort_order', q.sort_order,
               -- microsecond precision (.US): the admin echoes this verbatim as the CAS
               -- token on edit, so it MUST losslessly match the stored timestamptz — a
               -- second-truncated token would always read as stale_write.
               'updated_at', to_char(q.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) order by q.sort_order, q.code)
      from public.quiz_definition q), '[]'::jsonb)
  );
$$;

-- ── admin upsert: create OR edit one question (VOLATILE — it WRITES) ─────────────────────
-- The CAS token doubles as the create/edit discriminator (resolves the "upsert can't tell
-- create from edit" ambiguity):
--   • p_prev_updated_at IS NULL     → CREATE. Insert; if `code` exists → reason 'duplicate_code'.
--   • p_prev_updated_at IS NOT NULL → EDIT.   Must exist (else 'not_found'); stored updated_at
--                                     must match p_prev_updated_at (else 'stale_write').
-- `code` is immutable (it is the edit key + the quiz_completion FK target). Rich input
-- validation is authoritative in Pydantic (clean 422 before the RPC); the guards below are
-- defense-in-depth so a direct/edge call can never RAISE the table CHECK into a 503.
create or replace function admin.upsert_quiz_question(
  p_code            text,
  p_prompt          text,
  p_options         jsonb,
  p_correct_index   int,
  p_explanation     text,
  p_sort_order      int,
  p_prev_updated_at timestamptz default null
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_opt_len int;
begin
  -- Defense-in-depth validation (NULL required scalars rejected BEFORE range checks, else a
  -- NULL makes the range predicate evaluate NULL and the table CHECK raises a raw 23502/23514).
  if p_code is null or char_length(btrim(p_code)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_code', 'field', 'code');
  end if;
  if p_prompt is null or char_length(btrim(p_prompt)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_prompt', 'field', 'prompt');
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'options_not_array', 'field', 'options');
  end if;
  v_opt_len := jsonb_array_length(p_options);
  if v_opt_len < 2 or v_opt_len > 4 then
    return jsonb_build_object('ok', false, 'reason', 'options_len', 'field', 'options');
  end if;
  if p_correct_index is null or p_correct_index < 0 or p_correct_index >= v_opt_len then
    return jsonb_build_object('ok', false, 'reason', 'correct_index_range', 'field', 'correct_index');
  end if;
  if p_sort_order is null or p_sort_order < 0 then
    return jsonb_build_object('ok', false, 'reason', 'sort_order_negative', 'field', 'sort_order');
  end if;

  if p_prev_updated_at is null then
    -- CREATE
    insert into public.quiz_definition (code, prompt, options, correct_index, explanation, sort_order, updated_at)
    values (p_code, p_prompt, p_options, p_correct_index, nullif(p_explanation, ''), p_sort_order, now())
    on conflict (code) do nothing;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'duplicate_code', 'field', 'code');
    end if;
  else
    -- EDIT — ATOMIC compare-and-swap: the token is folded INTO the UPDATE predicate so the check
    -- and the write are one statement. Two concurrent edits carrying the same base token cannot
    -- both win: the first bumps updated_at, the second then matches 0 rows and is reported stale
    -- (a check-then-UPDATE with the token only in a prior SELECT would let the second clobber the
    -- first under READ COMMITTED). The follow-up existence check only distinguishes stale from
    -- not_found and is race-benign.
    update public.quiz_definition
       set prompt = p_prompt,
           options = p_options,
           correct_index = p_correct_index,
           explanation = nullif(p_explanation, ''),
           sort_order = p_sort_order,
           updated_at = now()
     where code = p_code
       and updated_at is not distinct from p_prev_updated_at;
    if not found then
      if exists (select 1 from public.quiz_definition where code = p_code) then
        return jsonb_build_object('ok', false, 'reason', 'stale_write');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'row', (
      select jsonb_build_object(
               'code', q.code,
               'prompt', q.prompt,
               'options', q.options,
               'correct_index', q.correct_index,
               'explanation', q.explanation,
               'sort_order', q.sort_order,
               'updated_at', to_char(q.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             )
      from public.quiz_definition q where q.code = p_code
    )
  );
end;
$$;

-- ── admin delete: soft-block questions that have been answered (VOLATILE) ─────────────────
-- D5: a question any learner has completed must NOT be deletable (preserves earned-XP
-- history). The EXCEPTION handler is the AUTHORITATIVE guard — it closes the TOCTOU race
-- where a submit_quiz commits a completion between a pre-check and the DELETE. Returns a
-- structured result; never raises a raw 23503 (which the backend would mis-map to 503).
create or replace function admin.delete_quiz_question(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.quiz_definition where code = p_code;
  if not found then
    return jsonb_build_object('ok', false, 'deleted', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'deleted', true);
exception
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'deleted', false, 'reason', 'has_completions');
end;
$$;

-- ── ownership (RLS-bypass invariant, self-documenting) ───────────────────────────────────
alter function admin.list_quiz()                                              owner to postgres;
alter function admin.upsert_quiz_question(text, text, jsonb, int, text, int, timestamptz) owner to postgres;
alter function admin.delete_quiz_question(text)                               owner to postgres;

-- ── grant matrix ─────────────────────────────────────────────────────────────────────────
-- admin.* : the per-function revoke from public/anon/authenticated is the real guarantee
-- (`from public` alone is NOT enough — the SIM-5 default-privilege trap); EXECUTE only to
-- metrics_reader (which performs these admin-gated writes — a slight misnomer, kept per SIM-17).
revoke all on schema admin from public;                                       -- idempotent
revoke all on function admin.list_quiz()                                              from public, anon, authenticated;
revoke all on function admin.upsert_quiz_question(text, text, jsonb, int, text, int, timestamptz) from public, anon, authenticated;
revoke all on function admin.delete_quiz_question(text)                               from public, anon, authenticated;
grant usage on schema admin to metrics_reader;                                -- idempotent
grant execute on function admin.list_quiz()                                              to metrics_reader;
grant execute on function admin.upsert_quiz_question(text, text, jsonb, int, text, int, timestamptz) to metrics_reader;
grant execute on function admin.delete_quiz_question(text)                               to metrics_reader;
alter default privileges in schema admin revoke execute on functions from public, anon, authenticated;
