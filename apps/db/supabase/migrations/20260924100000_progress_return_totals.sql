-- Return authoritative totals from the reward path so mutating RPCs can hand the
-- post-credit {xp, point} back to the client in a single round-trip (no follow-up
-- re-select). add_rewards changes its return type, which CREATE OR REPLACE cannot
-- do — so drop first. A plpgsql body that calls add_rewards creates no hard
-- dependency (the reference resolves at runtime), so the drop is safe even though
-- claim_mission calls it.

drop function if exists public.add_rewards(int, int);

-- PRIVATE reward helper — credits the CURRENT user and returns the new totals.
-- Never client-callable (that would be an xp/point printer); only other SECURITY
-- DEFINER RPCs call it. Additive upsert, negatives clamped.
create or replace function public.add_rewards(p_xp int, p_point int)
returns table (xp int, point int)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  insert into public.user_progress as up (user_id, xp, point)
  values ((select auth.uid()), greatest(p_xp, 0), greatest(p_point, 0))
  on conflict (user_id) do update
    set xp = up.xp + excluded.xp,
        point = up.point + excluded.point
  returning up.xp, up.point;
end;
$$;
revoke execute on function public.add_rewards(int, int) from public, anon, authenticated;

-- claim_mission now threads the authoritative post-credit totals through its result
-- so the client reconciles without a re-select. Behaviour is otherwise unchanged
-- (one-time claim via unique(user_id, mission_id), reallife gate validated server-side).
create or replace function public.claim_mission(p_mission_id text, p_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.mission_definition;
  v_id bigint;
  v_totals record;
begin
  select * into m from public.mission_definition where code = p_mission_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if m.kind = 'reallife'
     and (p_code is null or lower(btrim(p_code)) <> lower(btrim(m.redeem_code))) then
    return jsonb_build_object('ok', false, 'reason', 'wrong-code');
  end if;

  insert into public.mission_completion (user_id, mission_id)
  values ((select auth.uid()), p_mission_id)
  on conflict (user_id, mission_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  select * into v_totals from public.add_rewards(m.reward_xp, m.reward_point);
  return jsonb_build_object('ok', true,
    'reward', jsonb_build_object('xp', m.reward_xp, 'point', m.reward_point),
    'totals', jsonb_build_object('xp', v_totals.xp, 'point', v_totals.point));
end;
$$;
-- Revoke from anon explicitly (default-privilege EXECUTE), matching the SIM-5 write
-- RPCs. Practically anon's null auth.uid() already fails the insert, but this keeps
-- the hardening consistent across every reward-writing function.
revoke execute on function public.claim_mission(text, text) from public, anon;
grant execute on function public.claim_mission(text, text) to authenticated;

-- Same anon-revoke parity for the other reward/economy write RPCs defined earlier
-- (they exist by this migration; revoke is idempotent and does not alter behavior).
revoke execute on function public.redeem_voucher(text) from anon;
revoke execute on function public.record_session_result(uuid, text, text, jsonb, jsonb, text) from anon;
