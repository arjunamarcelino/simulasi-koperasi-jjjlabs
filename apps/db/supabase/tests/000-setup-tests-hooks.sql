-- pgTAP setup + self-contained auth test helpers.
--
-- Intentionally NOT wrapped in begin/rollback: these objects must persist for the
-- test files that follow in the same `supabase test db` run. Idempotent so re-runs
-- are safe. Vendored (no external extension) to keep CI dependency-free.
--
-- Role switching works because the test session user is the superuser `postgres`
-- (SET ROLE membership is checked against the session user), so we can impersonate
-- authenticated/anon/service_role freely and switch back.

create extension if not exists pgtap;

create schema if not exists tests;

-- Create a real auth.users row (fires handle_new_user → provisions profiles +
-- user_progress). Returns the new user id. Stashes `identifier` in metadata so
-- tests can look the id up by a friendly name.
create or replace function tests.create_user(identifier text, metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    identifier || '@test.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('test_identifier', identifier) || coalesce(metadata, '{}'::jsonb),
    now(), now()
  );
  return v_uid;
end;
$$;

-- Resolve a user id by the friendly identifier.
create or replace function tests.get_uid(identifier text)
returns uuid language sql security definer set search_path = '' as $$
  select id from auth.users where raw_user_meta_data ->> 'test_identifier' = identifier;
$$;

-- Impersonate an authenticated user (sets role + JWT claims so auth.uid() resolves).
create or replace function tests.login_as(identifier text)
returns void language plpgsql as $$
declare
  v_uid uuid := tests.get_uid(identifier);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'email', identifier || '@test.local')::text,
    true
  );
end;
$$;

-- Drop to the anonymous (unauthenticated) API role.
create or replace function tests.login_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- Elevate to service_role (bypasses RLS) for ground-truth setup/assertions.
create or replace function tests.login_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- pgTAP assertion: a table has RLS enabled.
create or replace function tests.rls_enabled(p_schema text, p_table text)
returns text language sql as $$
  select is(
    (select count(*)::int from pg_tables
      where schemaname = p_schema and tablename = p_table and rowsecurity = true),
    1,
    format('%I.%I has RLS enabled', p_schema, p_table)
  );
$$;
