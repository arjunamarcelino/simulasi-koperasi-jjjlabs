-- Foundation — applied first (earliest reserved timestamp). Everything downstream
-- FKs to public.profiles. Shared helpers are declared ONLY here.
--
-- Identity model: public.profiles is 1:1 with auth.users (guests included). A
-- signup trigger provisions profiles + user_progress so the 1:1 holds from birth.
-- Level is DERIVED from xp (never stored) via an IMMUTABLE function.

-- updated_at helper (declared once; reused by every table with updated_at).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Derived level. Thresholds mirror apps/web ProfileModal LEVELS
-- ([0,100,300,600,1000,1500]); 1-based (Calon Anggota = 1). Hardcoded so the
-- function is genuinely IMMUTABLE (no table read). Negatives clamp to tier 1.
create or replace function public.level_from_xp(p_xp int)
returns int language sql immutable as $$
  select case
    when p_xp >= 1500 then 6
    when p_xp >= 1000 then 5
    when p_xp >= 600  then 4
    when p_xp >= 300  then 3
    when p_xp >= 100  then 2
    else 1
  end;
$$;

-- Identity.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Progress (1:1 with profiles). xp drives derived level; point is spent on vouchers.
create table public.user_progress (
  user_id uuid primary key references public.profiles on delete cascade,
  xp int not null default 0 check (xp >= 0),
  point int not null default 0 check (point >= 0),
  updated_at timestamptz not null default now()
);
create trigger user_progress_set_updated_at before update on public.user_progress
  for each row execute function public.set_updated_at();
-- Serves the leaderboard scan (public.leaderboard(), added in the progress migration).
create index user_progress_xp_desc_idx on public.user_progress (xp desc) where xp > 0;

-- Auto-provision profile + progress for every new auth user (anonymous or permanent).
-- SECURITY DEFINER + empty search_path (hardening); every ref schema-qualified.
-- Defensive: truncate long OAuth display names to the 16-char cap; never block signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'name', ''), 16), ''))
  on conflict (id) do nothing;

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS — owner-only. Writes to user_progress go exclusively through SECURITY DEFINER
-- RPCs (add_rewards / redeem_voucher), so no client insert/update policy is granted.
alter table public.profiles enable row level security;
alter table public.user_progress enable row level security;

create policy "profiles: owner select" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: owner update" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles: owner insert" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

create policy "user_progress: owner select" on public.user_progress
  for select to authenticated using ((select auth.uid()) = user_id);
