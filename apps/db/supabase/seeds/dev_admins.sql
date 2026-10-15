-- Dev-only seed: promote one existing auth user to admin so the admin dashboard
-- (apps/admin) is reachable locally before any real promotion flow exists (SIM-14).
--
-- NEVER run against production. Runs as the DB owner (bypasses RLS).
-- This is NOT part of the generated seed.sql and must NOT be added to config.toml
-- `db.seed.sql_paths` — the admin row FKs to auth.users(id), so running it against an
-- empty auth.users would hard-fail the FK and break `supabase start` / `db reset`.
--
-- Order matters: the auth user must exist FIRST (create it via the Studio Auth UI or
-- the Admin API), THEN run this to insert the membership row.
--
-- Usage (local Supabase):
--   1. Sign up / create an email admin and find its uid:  select id, email from auth.users;
--   2. psql "$LOCAL_DB_URL" -v uid="<that-uuid>" -f apps/db/supabase/seeds/dev_admins.sql
--   3. Re-login (or refresh the session) so the hook stamps is_admin:true into the JWT.

\set ON_ERROR_STOP on

insert into public.admins (user_id)
values (:'uid')
on conflict (user_id) do nothing;
