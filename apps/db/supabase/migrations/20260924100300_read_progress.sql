-- Batched boot hydrate + batched badge write. get_my_progress collapses the four
-- per-user reads into one round-trip and one consistent snapshot; sync_badges writes
-- N newly-earned badges in one statement instead of N inserts.

-- One-shot hydrate snapshot for the current user. Voucher rows are shaped to match
-- the FE RedeemedVoucher record (voucherId/name/code/redeemedAt-ms) so the store can
-- adopt them directly. STABLE so the planner treats auth.uid() consistently.
create or replace function public.get_my_progress()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'progress', (
      select jsonb_build_object('xp', up.xp, 'point', up.point)
      from public.user_progress up where up.user_id = (select auth.uid())
    ),
    'missions', coalesce((
      select jsonb_agg(mc.mission_id order by mc.mission_id)
      from public.mission_completion mc where mc.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'vouchers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'voucherId', vr.voucher_id,
               'name', vr.voucher_name,
               'code', vr.minted_code,
               'redeemedAt', (extract(epoch from vr.redeemed_at) * 1000)::bigint
             ) order by vr.redeemed_at desc)
      from public.voucher_redemption vr where vr.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_agg(ub.badge_id order by ub.badge_id)
      from public.user_badge ub where ub.user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.get_my_progress() from public;
grant execute on function public.get_my_progress() to anon, authenticated;

-- Batch-insert newly-earned badges. Join-filtered to real badge codes; idempotent via
-- unique(user_id, badge_id). Badges are cosmetic (no reward derives from them), so an
-- owner-scoped self-insert is acceptable — this just replaces N client inserts with 1.
create or replace function public.sync_badges(p_codes text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_badge (user_id, badge_id)
  select (select auth.uid()), d.code
  from unnest(p_codes) as t(code)
  join public.badge_definition d on d.code = t.code
  on conflict (user_id, badge_id) do nothing;
end;
$$;
-- Write RPC: revoke from anon explicitly (default-privilege EXECUTE), authenticated only.
revoke execute on function public.sync_badges(text[]) from public, anon;
grant execute on function public.sync_badges(text[]) to authenticated;
