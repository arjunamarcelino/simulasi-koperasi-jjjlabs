-- admin.list_missions / set_mission_redeem_code (SIM-42).
--
-- Session user = superuser postgres, so the SECURITY DEFINER admin.* calls and direct
-- table reads bypass RLS. All admin.* + shape/grant assertions run first AS POSTGRES;
-- the runtime-linkage block logs in as real users LAST (authenticated roles cannot
-- EXECUTE admin.*). The error-contract invariant is proven by asserting every expected
-- rejection is a STRUCTURED RETURN ({ok:false, reason}) — never a raised exception.
begin;
select plan(40);

-- Fixtures: an actor + two claimers. The seed loads 7 missions (4 game, 3 reallife);
-- we operate on the reallife rows and never add any (rotate-only scope).
select tests.create_user('admin1');
select tests.create_user('claimer');
select tests.create_user('claimer2');

-- ── migration shape ──────────────────────────────────────────────────────────────────────
select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='mission_definition' and column_name='redeem_code_updated_at'),
  'YES', 'redeem_code_updated_at added nullable');
select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='mission_definition' and column_name='redeem_code_updated_by'),
  'YES', 'redeem_code_updated_by added nullable');
select is(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='mission_definition' and column_name='redeem_code_updated_by'),
  'uuid', 'redeem_code_updated_by is uuid');
select is(
  (select count(*)::int from pg_constraint
    where conrelid='public.mission_definition'::regclass and contype='f'),
  0, 'mission_definition has no FK (audit actor is a tombstone, not FK-coupled to auth.users)');

-- mission_catalog redaction unchanged: still {code,kind,title,description,reward_xp,reward_point,sort_order}
select is((select count(*)::int from information_schema.columns
             where table_schema='public' and table_name='mission_catalog'), 7,
  'mission_catalog still has exactly 7 columns');
select is((select count(*)::int from information_schema.columns
             where table_schema='public' and table_name='mission_catalog'
               and column_name in ('redeem_code','redeem_code_updated_at','redeem_code_updated_by')), 0,
  'mission_catalog leaks no redeem_code/audit columns');

-- ── admin.list_missions: reallife-only, exposes the hidden code, ordered by sort_order ─────
select is((admin.list_missions()->>'ok')::boolean, true, 'list_missions: ok');
select is(jsonb_array_length(admin.list_missions()->'rows'), 3, 'list_missions: 3 reallife rows (game excluded)');
select is((admin.list_missions() #>> '{rows,0,code}'), 'kunjungi-kdmp', 'list_missions: rows[0] = kunjungi-kdmp (sort_order 5, lowest reallife)');
select is((admin.list_missions() #>> '{rows,0,redeem_code}'), 'KDMP2026', 'list_missions: exposes redeem_code (hidden from catalog)');
select is((admin.list_missions() #>> '{rows,0,redeem_code_updated_at}'), null, 'list_missions: never-rotated row has NULL audit timestamp');

-- ── set_mission_redeem_code: positive (rotate kunjungi-kdmp) ───────────────────────────────
create temporary table rot1 as
  select admin.set_mission_redeem_code('kunjungi-kdmp', 'NEW123', tests.get_uid('admin1')) as r;
select is((select (r->>'ok')::boolean from rot1), true, 'rotate kunjungi-kdmp: ok');
select is((select r #>> '{row,redeem_code}' from rot1), 'NEW123', 'rotate: returned row carries new code');
select is((select redeem_code from public.mission_definition where code='kunjungi-kdmp'), 'NEW123', 'rotate: stored code updated');
select is((select redeem_code_updated_by from public.mission_definition where code='kunjungi-kdmp'),
  tests.get_uid('admin1'), 'rotate: audit actor recorded');
select ok((select redeem_code_updated_at is not null from public.mission_definition where code='kunjungi-kdmp'),
  'rotate: audit timestamp set');

-- btrim-on-write (plain select mutates; not a plan assertion)
select admin.set_mission_redeem_code('impact-umkm', '  SPACED  ', tests.get_uid('admin1'));
select is((select redeem_code from public.mission_definition where code='impact-umkm'), 'SPACED',
  'btrim-on-write: surrounding whitespace stripped before store');

-- rotate-to-same value is a harmless ok (keeps kunjungi-kdmp = NEW123 for the linkage block)
select is((admin.set_mission_redeem_code('kunjungi-kdmp', 'NEW123', tests.get_uid('admin1'))->>'ok')::boolean, true,
  'rotate-to-same value: ok');

-- length boundary: exactly 64 chars is accepted (only 65 is too_long — guards an off-by-one).
-- Uses ajak-anggota (untouched by the linkage/seed-durability blocks below).
select admin.set_mission_redeem_code('ajak-anggota', repeat('x', 64), tests.get_uid('admin1'));
select is((select char_length(redeem_code) from public.mission_definition where code='ajak-anggota'), 64,
  '64-char code accepted and stored (boundary just below too_long)');

-- ── set_mission_redeem_code: negatives (structured returns, NEVER a raised CHECK → 503) ────
select is((admin.set_mission_redeem_code('does-not-exist', 'X', tests.get_uid('admin1'))->>'reason'), 'not_found',
  'unknown mission: reason=not_found');
select is((admin.set_mission_redeem_code('main-kuis', 'X', tests.get_uid('admin1'))->>'reason'), 'not_found',
  'game mission: reason=not_found (collapsed, no 23514, no info leak)');
select is((admin.set_mission_redeem_code('kunjungi-kdmp', '', tests.get_uid('admin1'))->>'reason'), 'empty_redeem_code',
  'empty code: reason=empty_redeem_code');
select is((admin.set_mission_redeem_code('kunjungi-kdmp', '   ', tests.get_uid('admin1'))->>'reason'), 'empty_redeem_code',
  'whitespace-only code: reason=empty_redeem_code (no 23514 from nonblank CHECK)');
select is((admin.set_mission_redeem_code('kunjungi-kdmp', repeat('x', 65), tests.get_uid('admin1'))->>'reason'), 'too_long',
  '65-char code: reason=too_long');
select is((admin.set_mission_redeem_code('kunjungi-kdmp', null, tests.get_uid('admin1'))->>'reason'), 'empty_redeem_code',
  'NULL code: reason=empty_redeem_code (no 23502)');
select is((select redeem_code from public.mission_definition where code='main-kuis'), null,
  'game mission redeem_code remains NULL (rejected write never touched the row)');

-- ── grant matrix (SIM-5 per-function revoke trap) ──────────────────────────────────────────
select is(has_function_privilege('metrics_reader', 'admin.list_missions()', 'EXECUTE'), true,
  'metrics_reader can EXECUTE list_missions');
select is(has_function_privilege('metrics_reader', 'admin.set_mission_redeem_code(text,text,uuid)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE set_mission_redeem_code');
select is(has_function_privilege('anon', 'admin.set_mission_redeem_code(text,text,uuid)', 'EXECUTE'), false,
  'anon cannot EXECUTE set_mission_redeem_code');
select is(has_function_privilege('authenticated', 'admin.list_missions()', 'EXECUTE'), false,
  'authenticated cannot EXECUTE list_missions');
select is(has_function_privilege('public', 'admin.list_missions()', 'EXECUTE'), false,
  'public cannot EXECUTE list_missions (the hidden codes stay unreadable to every unprivileged role)');
select is(has_function_privilege('public', 'admin.set_mission_redeem_code(text,text,uuid)', 'EXECUTE'), false,
  'public cannot EXECUTE set_mission_redeem_code');
select is(has_table_privilege('metrics_reader', 'public.mission_definition', 'UPDATE'), false,
  'metrics_reader has NO direct UPDATE on mission_definition');
select is(has_table_privilege('metrics_reader', 'public.mission_definition', 'SELECT'), false,
  'metrics_reader has NO direct SELECT on mission_definition');
select is(has_schema_privilege('metrics_reader', 'admin', 'USAGE'), true,
  'metrics_reader has USAGE on admin');

-- ── seed durability (C1): a re-seed (conflict-update omits redeem_code) preserves rotation ──
-- This proves the SEMANTIC (an on-conflict set without redeem_code preserves a rotated value).
-- The GENERATOR side is enforced separately by gen-seed's MISSION_CONFLICT_UPDATE self-guard
-- (throws if redeem_code is re-added) + CI `gen:seed --check` parity — so a regression there
-- fails the build, not silently here.
insert into public.mission_definition (code, kind, title, description, reward_xp, reward_point, redeem_code, sort_order) values
  ('kunjungi-kdmp', 'reallife', 'Kunjungi KDMP', 'desc', 50, 100, 'KDMP2026', 5)
on conflict (code) do update set
  kind = excluded.kind, title = excluded.title, description = excluded.description,
  reward_xp = excluded.reward_xp, reward_point = excluded.reward_point, sort_order = excluded.sort_order;
select is((select redeem_code from public.mission_definition where code='kunjungi-kdmp'), 'NEW123',
  'seed durability: re-seed leaves the admin-rotated code intact');

-- ── runtime linkage (the feature's whole point): rotation flips claim_mission immediately ──
select tests.login_as('claimer');
select is((public.claim_mission('kunjungi-kdmp', 'KDMP2026') ->> 'reason'), 'wrong-code',
  'claim with OLD code after rotation → wrong-code');
select is((public.claim_mission('kunjungi-kdmp', 'NEW123') ->> 'ok'), 'true',
  'claim with ROTATED code → ok');
select tests.login_as('claimer2');
select is((public.claim_mission('kunjungi-kdmp', ' new123 ') ->> 'ok'), 'true',
  'claim with rotated code is case-insensitive + trimmed');
select tests.login_as_service();
select is((select count(*)::int from public.mission_completion where mission_id='kunjungi-kdmp'), 2,
  'both users claimed; rotation did not alter existing completions');

select * from finish();
rollback;
