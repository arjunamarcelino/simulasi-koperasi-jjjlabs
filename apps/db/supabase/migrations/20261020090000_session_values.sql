-- Personal feedback grounded in the ICA cooperative values (scenarios 2–4).
--
-- Three new result columns on public.sessions, written by the AI Auditor result:
--   values_json        per-session assessment of the scenario's ICA values:
--                      { "<value_key>": { "status", "evidence", "trend" } }
--   progress_feedback  the "Perjalanan Nilaimu" narrative (compares with past sessions)
--   next_step          one suggested next step; the NEXT session's auditor checks whether
--                      the player followed it (sent back as part of the player's history)
--
-- record_session is recreated with three new params APPENDED (safe defaults), so every
-- existing named-arg call keeps working. The old signature is DROPPED rather than
-- overloaded: two candidates differing only by trailing defaults make PostgREST's RPC
-- resolution ambiguous. Same TRUST BOUNDARY as before: these fields are client-authored
-- (relayed from the auditor result) and only ever shape the caller's own feedback.

alter table public.sessions
  add column values_json jsonb not null default '{}'::jsonb,
  add column progress_feedback text,
  add column next_step text;

drop function public.record_session(text, text, text, jsonb, jsonb, text, timestamptz);

create function public.record_session(
  p_scenario_id text,
  p_trigger text,
  p_ending_type text,
  p_scores jsonb default '{}'::jsonb,
  p_state jsonb default '{}'::jsonb,
  p_feedback text default null,
  p_started_at timestamptz default null,
  p_values jsonb default '{}'::jsonb,
  p_progress text default null,
  p_next_step text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_started timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if p_trigger is null or p_trigger not in ('manual', 'sinyal_level_1', 'force_quit_level_2')
     or p_ending_type is null or p_ending_type not in ('good', 'bad', 'neutral') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- Size guards: reject abusive payloads as structured data, not a raw error.
  if pg_column_size(coalesce(p_scores, '{}'::jsonb)) > 4096
     or pg_column_size(coalesce(p_state, '{}'::jsonb)) > 4096
     or pg_column_size(coalesce(p_values, '{}'::jsonb)) > 4096
     or char_length(coalesce(p_feedback, '')) > 4000
     or char_length(coalesce(p_progress, '')) > 2000
     or char_length(coalesce(p_next_step, '')) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'too_large');
  end if;
  -- Clamp so ended_at (now) >= started_at always holds, whatever the client clock says.
  v_started := least(coalesce(p_started_at, now()), now());

  insert into public.sessions
    (user_id, scenario_id, started_at, ended_at, trigger, ending_type,
     scores_json, state_json, narrative_feedback,
     values_json, progress_feedback, next_step)
  values
    (v_uid, p_scenario_id, v_started, now(), p_trigger, p_ending_type,
     coalesce(p_scores, '{}'::jsonb), coalesce(p_state, '{}'::jsonb), p_feedback,
     coalesce(p_values, '{}'::jsonb), p_progress, p_next_step)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'session_id', v_id);
exception
  when foreign_key_violation then
    -- unknown scenario_id (FK) — structured, swallowed by the FE best-effort path
    return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;
-- Revoke from public AND anon (the SIM-5 anon default-privilege trap); authenticated only.
revoke execute on function public.record_session(
  text, text, text, jsonb, jsonb, text, timestamptz, jsonb, text, text) from public, anon;
grant execute on function public.record_session(
  text, text, text, jsonb, jsonb, text, timestamptz, jsonb, text, text) to authenticated;

-- The legacy insert-open policy (unused by the FE since SIM-6) must also require the new
-- result columns to be empty, so a client still cannot forge a pre-assessed row without
-- going through the RPC.
drop policy "sessions: owner insert open" on public.sessions;
create policy "sessions: owner insert open" on public.sessions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and ended_at is null
    and trigger is null
    and ending_type is null
    and scores_json = '{}'::jsonb
    and state_json = '{}'::jsonb
    and narrative_feedback is null
    and values_json = '{}'::jsonb
    and progress_feedback is null
    and next_step is null
  );
