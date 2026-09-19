-- Gameplay — scenario catalog + sessions (score folded in as nullable columns).
-- A session row is written at START (ended_at null) and finalized atomically by
-- record_session_result at end, so an abandoned/errored session still leaves a trace.

create table public.scenario_definition (
  code text primary key,
  title text not null,
  difficulty text,                              -- FE display text; no closed-set CHECK
  status text not null check (status in ('AVAILABLE', 'COMING_SOON')),
  sort_order int not null default 0
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  scenario_id text not null references public.scenario_definition (code),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  trigger text check (trigger in ('manual', 'sinyal_level_1', 'force_quit_level_2')),
  ending_type text check (ending_type in ('good', 'bad', 'neutral')),
  scores_json jsonb not null default '{}'::jsonb,   -- per-scenario rubric, 0-100
  state_json jsonb not null default '{}'::jsonb,     -- AuditorResult.stateClassification
  narrative_feedback text,
  -- A session is "ended" exactly when it carries a trigger.
  constraint sessions_ended_has_trigger check ((ended_at is null) = (trigger is null)),
  constraint sessions_time_order check (ended_at is null or ended_at >= started_at)
);
create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

-- Finalize a session atomically. Owner-checked internally; only updates an OPEN
-- session belonging to the caller. SECURITY DEFINER so it can run as one txn.
create or replace function public.record_session_result(
  p_session_id uuid,
  p_trigger text,
  p_ending_type text,
  p_scores jsonb default '{}'::jsonb,
  p_state jsonb default '{}'::jsonb,
  p_feedback text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update public.sessions
     set ended_at = now(),
         trigger = p_trigger,
         ending_type = p_ending_type,
         scores_json = coalesce(p_scores, '{}'::jsonb),
         state_json = coalesce(p_state, '{}'::jsonb),
         narrative_feedback = p_feedback
   where id = p_session_id
     and user_id = (select auth.uid())
     and ended_at is null
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found_or_closed');
  end if;
  return jsonb_build_object('ok', true, 'session_id', v_id);
end;
$$;
revoke execute on function public.record_session_result(uuid, text, text, jsonb, jsonb, text) from public;
grant execute on function public.record_session_result(uuid, text, text, jsonb, jsonb, text) to authenticated;

-- RLS.
alter table public.scenario_definition enable row level security;
alter table public.sessions enable row level security;

create policy "scenario_definition: public read" on public.scenario_definition
  for select to anon, authenticated using (true);

create policy "sessions: owner select" on public.sessions
  for select to authenticated using ((select auth.uid()) = user_id);
-- Clients may only OPEN a session (all result columns must be empty); finalization
-- goes exclusively through record_session_result. This keeps a client from forging
-- an already-scored session and bypassing the RPC. No client UPDATE policy either.
create policy "sessions: owner insert open" on public.sessions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and ended_at is null
    and trigger is null
    and ending_type is null
    and scores_json = '{}'::jsonb
    and state_json = '{}'::jsonb
    and narrative_feedback is null
  );
