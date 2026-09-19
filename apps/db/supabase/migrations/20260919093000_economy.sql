-- Economy — mission/voucher catalogs, one-time mission claims, repeatable voucher
-- redemption. Depends on the foundation (user_progress) via add_rewards (reserved
-- timestamp > progress migration).

create table public.mission_definition (
  code text primary key,
  kind text not null check (kind in ('game', 'reallife')),
  title text,
  description text,
  reward_xp int not null default 0 check (reward_xp >= 0),
  reward_point int not null default 0 check (reward_point >= 0),
  redeem_code text,                             -- server-side secret; reallife only
  sort_order int not null default 0,
  constraint mission_reallife_has_code check ((kind = 'reallife') = (redeem_code is not null)),
  constraint mission_redeem_code_nonblank check (redeem_code is null or char_length(btrim(redeem_code)) > 0)
);

-- Secret-code hiding: Supabase auto-grants new public tables to anon/authenticated,
-- so REVOKE explicitly. Clients read the catalog through a view that omits redeem_code.
-- The view is a PLAIN (owner-privileged) view — do NOT set security_invoker, or the
-- caller (who has no privilege on the base table) reads nothing. A Supabase linter
-- "security_definer_view" warning here is an expected false positive.
alter table public.mission_definition enable row level security;
revoke all on table public.mission_definition from anon, authenticated;

create view public.mission_catalog as
  select code, kind, title, description, reward_xp, reward_point, sort_order
  from public.mission_definition;
grant select on public.mission_catalog to anon, authenticated;

create table public.mission_completion (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  mission_id text not null references public.mission_definition (code),
  completed_at timestamptz not null default now(),
  unique (user_id, mission_id)                  -- one-time claim
);

create table public.voucher_definition (
  code text primary key,
  name text not null,
  cost int not null check (cost >= 0),
  description text,
  sort_order int not null default 0
);

create table public.voucher_redemption (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  voucher_id text not null references public.voucher_definition (code),
  voucher_name text not null,                   -- denormalized (self-describing record)
  minted_code text not null unique,
  cost_point int not null check (cost_point >= 0),
  redeemed_at timestamptz not null default now()
);
create index voucher_redemption_user_idx on public.voucher_redemption (user_id, redeemed_at desc);

-- Claim a mission once. Validates the reallife code server-side; credits the reward
-- atomically only on the first (winning) insert. Idempotent under concurrent calls
-- via the unique(user_id, mission_id) constraint.
create or replace function public.claim_mission(p_mission_id text, p_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.mission_definition;
  v_id bigint;
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

  perform public.add_rewards(m.reward_xp, m.reward_point);
  return jsonb_build_object('ok', true,
    'reward', jsonb_build_object('xp', m.reward_xp, 'point', m.reward_point));
end;
$$;
revoke execute on function public.claim_mission(text, text) from public;
grant execute on function public.claim_mission(text, text) to authenticated;

-- Redeem a voucher (repeatable). Atomic conditional debit rejects insufficient
-- balance race-safely (guard lives in the UPDATE WHERE); mints a unique code.
create or replace function public.redeem_voucher(p_voucher_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.voucher_definition;
  v_balance int;
  v_code text;
begin
  select * into v from public.voucher_definition where code = p_voucher_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  update public.user_progress
     set point = point - v.cost
   where user_id = (select auth.uid())
     and point >= v.cost
  returning point into v_balance;

  if v_balance is null then
    return jsonb_build_object('ok', false, 'reason', 'insufficient');
  end if;

  v_code := 'KDMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.voucher_redemption (user_id, voucher_id, voucher_name, minted_code, cost_point)
  values ((select auth.uid()), v.code, v.name, v_code, v.cost);

  return jsonb_build_object('ok', true, 'code', v_code, 'balance', v_balance);
end;
$$;
revoke execute on function public.redeem_voucher(text) from public;
grant execute on function public.redeem_voucher(text) to authenticated;

-- RLS. Catalog: public read. User tables: owner select; writes go through the RPCs.
alter table public.mission_completion enable row level security;
alter table public.voucher_definition enable row level security;
alter table public.voucher_redemption enable row level security;

create policy "voucher_definition: public read" on public.voucher_definition
  for select to anon, authenticated using (true);

create policy "mission_completion: owner select" on public.mission_completion
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "voucher_redemption: owner select" on public.voucher_redemption
  for select to authenticated using ((select auth.uid()) = user_id);
