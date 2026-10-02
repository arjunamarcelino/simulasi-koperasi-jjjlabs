-- Harden the reallife code gate in claim_mission to fail CLOSED (SIM-9).
--
-- The previous gate used `p_code <> m.redeem_code`. Against a NULL redeem_code that
-- yields NULL (three-valued logic), so `p_code is null or NULL` is not-true and the
-- branch would FALL THROUGH and credit the mission without validating a code. Today the
-- `mission_reallife_has_code` CHECK constraint makes a NULL redeem_code unreachable, so
-- this is not currently exploitable — but once SIM-42's admin UI can write redeem_code
-- outside gen-seed, the RPC is the only runtime fail-closed point. Make it safe now.
--
-- NULL-safe form: `is distinct from` treats a NULL submitted code as "differs" (→ reject),
-- and the explicit `m.redeem_code is null` rejects a code-less reallife row. Behaviour for
-- every existing case (wrong code, correct code, trim + case-insensitive) is unchanged.

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
     and (m.redeem_code is null
          or lower(btrim(p_code)) is distinct from lower(btrim(m.redeem_code))) then
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
-- CREATE OR REPLACE keeps the existing ACL, but re-assert it so the grant model is
-- self-documenting at the point the function is (re)defined.
revoke execute on function public.claim_mission(text, text) from public, anon;
grant execute on function public.claim_mission(text, text) to authenticated;
