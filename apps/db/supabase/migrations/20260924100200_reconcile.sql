-- One-time migration of a pre-existing local wallet into the DB. Guarded by an
-- atomic marker so it runs at most once per account.
--
-- Only XP (cosmetic / level) and game-mission completion STATE are imported. The
-- spendable `point` currency is deliberately NOT migrated: the server cannot prove a
-- client-supplied balance, and a fresh anonymous account is indistinguishable from a
-- returning player, so importing spendable currency would let anyone mint free
-- vouchers. XP inflation is bounded by a catalog-derived ceiling and grants nothing
-- spendable. Vouchers are not carried (local codes were cosmetic; the point cost is
-- moot now that point isn't migrated).

alter table public.user_progress add column reconciled_at timestamptz;

create or replace function public.reconcile_local_progress(
  p_uid uuid, p_xp int, p_missions text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_max_xp int;
  v_totals record;
begin
  -- Defense-in-depth: abort (never redirect the write) if the client's expected uid
  -- has drifted from the live session — e.g. an in-flight call across a token swap.
  if p_uid is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'uid_mismatch');
  end if;

  -- Ensure the progress row exists before the marker claim. The signup trigger
  -- normally provisions it, but this makes "row absent" distinct from "already
  -- reconciled" so a missing row can never be misread as done (which would delete the
  -- client's legacy keys without crediting — a silent, irreversible loss).
  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;

  -- Atomic marker-first claim. The conditional UPDATE takes the row lock and is the
  -- serialization point: a concurrent (multi-tab) call blocks, then matches 0 rows
  -- and skips — so the credit below can never land twice.
  update public.user_progress
     set reconciled_at = now()
   where user_id = v_uid
     and reconciled_at is null;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'already');
  end if;

  -- XP ceiling = every mission's reward + the bounded lifetime quiz max, both derived
  -- from the catalog so the bound tracks the seed automatically (no hardcoded count).
  select coalesce(sum(reward_xp), 0) into v_max_xp from public.mission_definition;
  v_max_xp := v_max_xp + (select count(*) * 10 from public.quiz_definition);

  -- Credit XP only (point stays 0); reuse add_rewards' returned totals — no re-select.
  select xp, point into v_totals
  from public.add_rewards(least(greatest(p_xp, 0), v_max_xp), 0);

  -- Game-mission completions only, join-filtered: reallife missions stay gated by
  -- claim_mission's redeem_code, and an unknown/stale local code is dropped rather
  -- than FK-violating and permanently rolling the whole reconcile back.
  insert into public.mission_completion (user_id, mission_id)
  select v_uid, d.code
  from unnest(p_missions) as t(code)
  join public.mission_definition d on d.code = t.code and d.kind = 'game'
  on conflict (user_id, mission_id) do nothing;

  return jsonb_build_object('ok', true,
    'totals', jsonb_build_object('xp', v_totals.xp, 'point', v_totals.point));
end;
$$;
-- anon gets EXECUTE via a default privilege in this setup, so revoke from it too.
revoke execute on function public.reconcile_local_progress(uuid, int, text[]) from public, anon;
grant execute on function public.reconcile_local_progress(uuid, int, text[]) to authenticated;
