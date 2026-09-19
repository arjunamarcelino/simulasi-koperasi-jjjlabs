-- Achievements — badge catalog + earned join. No RPC: the client inserts the
-- earned row directly under an owner-only RLS policy, idempotent via the unique
-- constraint. Badges are client-trusted / cosmetic (no reward is derived from them);
-- the earn rule (isEarned) is evaluated client-side. awarded_at is the new fact.

create table public.badge_definition (
  code text primary key,
  title text not null,
  requirement text,
  icon text not null check (icon in ('medal','book','ticket','compass','coin','flag','trophy','piggy','check')),
  criteria jsonb,                               -- mirrors BadgeCriteria; null = teaser
  sort_order int not null default 0
);

create table public.user_badge (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  badge_id text not null references public.badge_definition (code),
  awarded_at timestamptz not null default now(),
  unique (user_id, badge_id)                    -- earn once
);
create index user_badge_user_idx on public.user_badge (user_id, awarded_at desc);

alter table public.badge_definition enable row level security;
alter table public.user_badge enable row level security;

create policy "badge_definition: public read" on public.badge_definition
  for select to anon, authenticated using (true);

create policy "user_badge: owner select" on public.user_badge
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_badge: owner insert" on public.user_badge
  for insert to authenticated with check ((select auth.uid()) = user_id);
