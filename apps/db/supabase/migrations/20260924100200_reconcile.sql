-- One-time migration of a pre-existing local wallet into the DB. Guarded by an
-- atomic marker so it runs at most once per account, clamps forged inflation to a
-- catalog-derived ceiling, and copies only game-mission completion STATE (never
-- replays rewards/costs). Vouchers are intentionally NOT carried: the local voucher
-- codes were cosmetic and the point cost is already baked into the migrated balance,
-- so copying them would forge free redeemable codes.

alter table public.user_progress add column reconciled_at timestamptz;

create or replace function public.reconcile_local_progress(
  p_uid uuid, p_xp int, p_point int, p_missions text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_max_xp int;
  v_max_pt int;
  v_totals record;
begin
  -- Defense-in-depth: abort (never redirect the write) if the client's expected uid
  -- has drifted from the live session — e.g. an in-flight call across a token swap.
  if p_uid is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'uid_mismatch');
  end if;

  -- Atomic marker-first claim. The conditional UPDATE takes the row lock and is the
  -- serialization point: a concurrent (multi-tab) call blocks, then matches 0 rows
  -- and skips — so the additive credit below can never land twice.
  update public.user_progress
     set reconciled_at = now()
   where user_id = v_uid
     and reconciled_at is null;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'already');
  end if;

  -- Ceiling = the most a legitimate pre-migration player could hold: every mission
  -- reward plus the bounded lifetime quiz max (200 each). Clamps an inflated import.
  select coalesce(sum(reward_xp), 0) + 200 into v_max_xp from public.mission_definition;
  select coalesce(sum(reward_point), 0) + 200 into v_max_pt from public.mission_definition;

  perform public.add_rewards(least(greatest(p_xp, 0), v_max_xp),
                             least(greatest(p_point, 0), v_max_pt));

  -- Game-mission completions only, join-filtered: reallife missions stay gated by
  -- claim_mission's redeem_code, and an unknown/stale local code is dropped rather
  -- than FK-violating and permanently rolling the whole reconcile back.
  insert into public.mission_completion (user_id, mission_id)
  select v_uid, d.code
  from unnest(p_missions) as t(code)
  join public.mission_definition d on d.code = t.code and d.kind = 'game'
  on conflict (user_id, mission_id) do nothing;

  select up.xp, up.point into v_totals from public.user_progress up where up.user_id = v_uid;
  return jsonb_build_object('ok', true,
    'totals', jsonb_build_object('xp', coalesce(v_totals.xp, 0), 'point', coalesce(v_totals.point, 0)));
end;
$$;
-- anon gets EXECUTE via a default privilege in this setup, so revoke from it too.
revoke execute on function public.reconcile_local_progress(uuid, int, int, text[]) from public, anon;
grant execute on function public.reconcile_local_progress(uuid, int, int, text[]) to authenticated;
