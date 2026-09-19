-- Progress RPCs. The user_progress table lives in the foundation migration; this
-- file adds the reward helper and the leaderboard projection.

-- PRIVATE reward helper — credits the CURRENT user. Never client-callable (that
-- would be an xp/point printer). Called only from other SECURITY DEFINER RPCs.
create or replace function public.add_rewards(p_xp int, p_point int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_progress (user_id, xp, point)
  values ((select auth.uid()), greatest(p_xp, 0), greatest(p_point, 0))
  on conflict (user_id) do update
    set xp = user_progress.xp + excluded.xp,
        point = user_progress.point + excluded.point;
end;
$$;
revoke execute on function public.add_rewards(int, int) from public, anon, authenticated;

-- Leaderboard — deliberately bypasses owner-only RLS to publish a bounded public
-- projection (display_name + xp + derived level). This is the intended exposure.
create or replace function public.leaderboard(p_limit int default 20)
returns table (display_name text, xp int, level int)
language sql stable security definer set search_path = '' as $$
  select p.display_name, up.xp, public.level_from_xp(up.xp)
  from public.user_progress up
  join public.profiles p on p.id = up.user_id
  where up.xp > 0
  order by up.xp desc
  limit greatest(p_limit, 0);
$$;
revoke execute on function public.leaderboard(int) from public;
grant execute on function public.leaderboard(int) to anon, authenticated;
