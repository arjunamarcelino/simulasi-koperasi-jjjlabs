-- Admin role (SIM-14). A dedicated membership table + a GoTrue custom access token
-- hook that stamps a top-level boolean `is_admin` claim into every JWT. Admin is used
-- ONLY by the admin dashboard (apps/admin) — the game is untouched.
--
-- Design (see docs/plans/2026-10-03-feat-admin-role-protected-area-plan.md):
-- - `public.admins` is NOT combined with profiles/user. RLS on, NO client policies;
--   membership is managed by service_role / seed only.
-- - The hook is GRANT-BASED (not SECURITY DEFINER): GoTrue calls it as
--   `supabase_auth_admin`, which reads `admins` via an explicit GRANT SELECT + a
--   supabase_auth_admin-only RLS policy (least privilege in the token-mint path).
-- - The hook is FAIL-SAFE: it runs for EVERY token mint/refresh in the project,
--   including anonymous game guests, so any error returns the event untouched with
--   `is_admin:false` and NEVER raises — a raising hook would break login for the
--   whole game, not just admin.
-- - The backend (apps/backend) reads `is_admin` from the verified JWT and enforces
--   `require_role('admin')`; it stays DB-free. The `role` claim is never touched.

-- Membership table. FK cascade mirrors public.profiles (foundation migration).
create table public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

-- RLS on with NO anon/authenticated policies ⇒ clients are fully denied read + write.
-- supabase_auth_admin does NOT bypass RLS (unlike service_role, which is why seeding
-- works), so the select policy below is REQUIRED for the hook to read the table — do
-- not "simplify" it away.
alter table public.admins enable row level security;

-- Belt-and-suspenders: strip default-privilege grants from client roles. `revoke ...
-- from public` alone is NOT enough — Supabase default-privileges grant to anon /
-- authenticated explicitly (SIM-5 learning).
revoke all on table public.admins from anon, authenticated, public;

-- The hook reads `admins` as supabase_auth_admin.
grant usage on schema public to supabase_auth_admin;
grant select on table public.admins to supabase_auth_admin;
create policy "auth_admin_reads_admins"
  on public.admins as permissive for select
  to supabase_auth_admin using (true);

-- Custom access token hook. Grant-based (NOT security definer). search_path pinned
-- (repo hardening convention, cf. handle_new_user). Fail-safe: the whole body is
-- guarded so a malformed event can never break token issuance for the game.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  claims jsonb;
  _is_admin boolean := false;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  select exists(
    select 1 from public.admins a
    where a.user_id = (event ->> 'user_id')::uuid
  ) into _is_admin;
  claims := jsonb_set(claims, '{is_admin}', to_jsonb(coalesce(_is_admin, false)));
  return jsonb_set(event, '{claims}', claims);
exception when others then
  -- fail-safe: never raise; stamp is_admin:false onto whatever claims we have.
  return jsonb_set(
    event, '{claims}',
    jsonb_set(coalesce(event -> 'claims', '{}'::jsonb), '{is_admin}', 'false'::jsonb)
  );
end;
$$;

-- Only GoTrue (supabase_auth_admin) may run the hook; clients cannot call it as an RPC.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated, public;
