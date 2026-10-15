-- Atomic insert-and-finalize for a completed session (PR #22 review, P2-1).
--
-- Supersedes the FE two-step (client INSERTs an OPEN row via the insert-open RLS policy,
-- then record_session_result finalizes it). That split was non-atomic: if the finalize
-- round-trip failed after the insert committed, an OPEN row was orphaned and the result
-- lost. This RPC inserts the row ALREADY finalized in one transaction — there is no
-- observable OPEN phase and nothing to orphan. The older two-phase record_session_result
-- + insert-open policy remain in place (immutable history) but are no longer used by the FE.
--
-- started_at is clamped to <= now() so a skewed client clock cannot trip the
-- sessions_time_order CHECK and silently lose the row (P2-2). Payloads are size-bounded
-- (P3-3). Bad inputs return a structured {ok:false,reason}, never a raw error.
create or replace function public.record_session(
  p_scenario_id text,
  p_trigger text,
  p_ending_type text,
  p_scores jsonb default '{}'::jsonb,
  p_state jsonb default '{}'::jsonb,
  p_feedback text default null,
  p_started_at timestamptz default null
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
  -- Size guards (P3-3): reject abusive payloads as structured data, not a raw error.
  if pg_column_size(coalesce(p_scores, '{}'::jsonb)) > 4096
     or pg_column_size(coalesce(p_state, '{}'::jsonb)) > 4096
     or char_length(coalesce(p_feedback, '')) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'too_large');
  end if;
  -- TRUST BOUNDARY (review P2-3): scores/state/feedback are CLIENT-AUTHORED — the auditor
  -- result is produced FE-side, not recomputed here. auth.uid() scopes every row to its
  -- caller, so a user can only fake their OWN history. Any future reward/leaderboard logic
  -- MUST recompute server-side and MUST NOT trust sessions.scores_json as authoritative.
  -- Clamp so ended_at (now) >= started_at always holds, whatever the client clock says.
  v_started := least(coalesce(p_started_at, now()), now());

  insert into public.sessions
    (user_id, scenario_id, started_at, ended_at, trigger, ending_type,
     scores_json, state_json, narrative_feedback)
  values
    (v_uid, p_scenario_id, v_started, now(), p_trigger, p_ending_type,
     coalesce(p_scores, '{}'::jsonb), coalesce(p_state, '{}'::jsonb), p_feedback)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'session_id', v_id);
exception
  when foreign_key_violation then
    -- unknown scenario_id (FK) — structured, swallowed by the FE best-effort path
    return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;
-- Revoke from public AND anon (the SIM-5 anon default-privilege trap); authenticated only.
revoke execute on function public.record_session(text, text, text, jsonb, jsonb, text, timestamptz) from public, anon;
grant execute on function public.record_session(text, text, text, jsonb, jsonb, text, timestamptz) to authenticated;
