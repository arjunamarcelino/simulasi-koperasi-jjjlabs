-- Admins table RLS + custom access token hook (SIM-14).
-- Clients can never read/write/execute the admin surface; supabase_auth_admin holds the
-- grants the hook needs; the hook stamps is_admin correctly and is fail-safe.
--
-- NOTE: the test session user is not a member of supabase_auth_admin, so we assert that
-- role's access via has_*_privilege (the grant matrix) rather than SET ROLE. The live
-- RLS-read path for the hook is proven by the WS-D e2e (real login decodes is_admin).
begin;
select plan(14);

select tests.rls_enabled('public', 'admins');

-- Grant matrix: supabase_auth_admin can read the table + execute the hook; clients can't.
select is(has_table_privilege('supabase_auth_admin', 'public.admins', 'SELECT'), true,
  'supabase_auth_admin has SELECT on admins');
select is(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'), true,
  'supabase_auth_admin can EXECUTE the hook');
select is(has_table_privilege('authenticated', 'public.admins', 'SELECT'), false,
  'authenticated has NO SELECT on admins');
select is(has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'), false,
  'authenticated cannot EXECUTE the hook');
select is(has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'), false,
  'anon cannot EXECUTE the hook');

-- Ground truth: one admin user, one ordinary user (create_user fires handle_new_user).
select tests.create_user('sim14_admin');
select tests.create_user('sim14_user');
insert into public.admins (user_id) values (tests.get_uid('sim14_admin'));

-- Negative: a client has no table privilege at all → SELECT/INSERT raise 42501 (the
-- privilege layer denies before RLS is even evaluated).
select tests.login_as('sim14_user');
select throws_ok(
  $$ select 1 from public.admins $$,
  '42501', null, 'authenticated cannot read admins');
select throws_ok(
  $$ insert into public.admins (user_id) values ('00000000-0000-0000-0000-000000000000') $$,
  '42501', null, 'authenticated cannot insert into admins');
select throws_ok(
  $$ select public.custom_access_token_hook('{}'::jsonb) $$,
  '42501', null, 'authenticated cannot execute the hook');
select tests.login_as_anon();
select throws_ok(
  $$ select 1 from public.admins $$,
  '42501', null, 'anon cannot read admins');
reset role;

-- Positive: the hook stamps is_admin:true for an admin, false for a non-admin.
select is(
  public.custom_access_token_hook(
    jsonb_build_object('user_id', tests.get_uid('sim14_admin')::text,
                       'claims', jsonb_build_object('role', 'authenticated'))
  ) -> 'claims' ->> 'is_admin',
  'true', 'hook stamps is_admin:true for an admin');
select is(
  public.custom_access_token_hook(
    jsonb_build_object('user_id', tests.get_uid('sim14_user')::text,
                       'claims', jsonb_build_object('role', 'authenticated'))
  ) -> 'claims' ->> 'is_admin',
  'false', 'hook stamps is_admin:false for a non-admin');

-- Edge: fail-safe on a malformed top-level event (bad uuid raises inside → caught),
-- and the original `role` claim is preserved.
select is(
  public.custom_access_token_hook('{"user_id":"not-a-uuid","claims":{"role":"authenticated"}}'::jsonb)
    -> 'claims' ->> 'is_admin',
  'false', 'hook is fail-safe on a malformed event (never raises)');
select is(
  public.custom_access_token_hook(
    jsonb_build_object('user_id', tests.get_uid('sim14_user')::text,
                       'claims', jsonb_build_object('role', 'authenticated'))
  ) -> 'claims' ->> 'role',
  'authenticated', 'hook preserves the original role claim');

select * from finish();
rollback;
