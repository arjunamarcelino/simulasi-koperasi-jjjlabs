-- admin.list_mading / upsert_mading_block / delete_mading_block / _mading_reject_reason (SIM-18).
--
-- Fixtures inserted inline (session user = postgres, bypasses RLS). Mutating fns invoked ONCE,
-- stashed in a temp table. Grant matrix asserted via has_*_privilege. The error-contract invariant
-- is proven by asserting every expected rejection is a STRUCTURED RETURN ({ok:false, reason}).
begin;
select plan(45);

-- The test DB is seeded (seed.sql loads mading_block rows incl identitas 'default'). Clear it
-- inside this rolled-back txn so the fixtures below don't collide and counts are hermetic.
delete from public.mading_block;

insert into public.mading_block (board, block_key, payload, sort_order) values
  ('info',      'seed-info', '{"title":"Seed","lines":["x"],"accent":"forest"}'::jsonb, 0),
  ('data',      'seed-data', '{"title":"Seed","headers":["H"],"rows":[["a"]]}'::jsonb, 0),
  ('knowledge', 'seed-kn',   '{"kind":"fact","text":"hi"}'::jsonb, 0),
  ('identitas', 'default',   '{"nama":"N","badanHukum":"B","alamat":"A","desa":"D"}'::jsonb, 0);

-- ── schema + grants ─────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_indexes
             where schemaname='public' and indexname='mading_block_identitas_singleton'), 1,
  'identitas singleton partial unique index exists');
select is((select count(*)::int from pg_indexes
             where schemaname='public' and indexname='mading_block_board_sort_idx'), 1,
  'board/sort_order index exists');
select is((select count(*)::int from information_schema.columns
             where table_schema='public' and table_name='mading_catalog'), 4,
  'mading_catalog has 4 columns');
select is((select bool_and(column_name in ('board','block_key','payload','sort_order'))
             from information_schema.columns
             where table_schema='public' and table_name='mading_catalog'), true,
  'mading_catalog columns are the expected set');
select is(has_table_privilege('anon', 'public.mading_catalog', 'SELECT'), true,
  'anon can SELECT mading_catalog (public content)');
select is(has_table_privilege('anon', 'public.mading_block', 'SELECT'), false,
  'anon has NO direct SELECT on mading_block');
select is(has_function_privilege('metrics_reader', 'admin.list_mading()', 'EXECUTE'), true,
  'metrics_reader can EXECUTE list_mading');
select is(has_function_privilege('metrics_reader',
  'admin.upsert_mading_block(uuid,text,text,jsonb,int,timestamptz)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE upsert_mading_block');
select is(has_function_privilege('metrics_reader', 'admin.delete_mading_block(uuid)', 'EXECUTE'), true,
  'metrics_reader can EXECUTE delete_mading_block');
select is(has_function_privilege('anon',
  'admin.upsert_mading_block(uuid,text,text,jsonb,int,timestamptz)', 'EXECUTE'), false,
  'anon cannot EXECUTE upsert_mading_block');
select is(has_function_privilege('public', 'admin.list_mading()', 'EXECUTE'), false,
  'public cannot EXECUTE list_mading');
select is(has_function_privilege('authenticated', 'admin.delete_mading_block(uuid)', 'EXECUTE'), false,
  'authenticated cannot EXECUTE delete_mading_block');

-- ── list_mading ─────────────────────────────────────────────────────────────────────────────
select is((admin.list_mading() ->> 'ok')::boolean, true, 'list_mading: ok');
select is(jsonb_array_length(admin.list_mading() #> '{groups,info}'), 1, 'list_mading: 1 info block');
select is(admin.list_mading() #>> '{groups,identitas,payload,nama}', 'N', 'list_mading: identitas payload present');
select is((admin.list_mading() #>> '{groups,info,0,updated_at}') like '%Z', true,
  'list_mading: item carries a CAS updated_at token');

-- ── _mading_reject_reason: valid payloads → NULL ──────────────────────────────────────────────
select ok(admin._mading_reject_reason('info', '{"title":"T","lines":["a"],"accent":"mustard"}'::jsonb) is null,
  'valid info → null');
select ok(admin._mading_reject_reason('data', '{"title":"T","headers":["H1","H2"],"rows":[["a","b"]]}'::jsonb) is null,
  'valid data → null');
select ok(admin._mading_reject_reason('knowledge', '{"kind":"stat","value":"1","label":"L"}'::jsonb) is null,
  'valid knowledge stat → null');
select ok(admin._mading_reject_reason('identitas', '{"nama":"N","badanHukum":"B","alamat":"A","desa":"D"}'::jsonb) is null,
  'valid identitas → null');

-- ── _mading_reject_reason: invalid payloads → reason ──────────────────────────────────────────
select is(admin._mading_reject_reason('info', '{"title":"T","lines":["a"],"accent":"neon"}'::jsonb), 'info_accent',
  'info bad accent');
select is(admin._mading_reject_reason('info', '{"title":"T","lines":[],"accent":"mustard"}'::jsonb), 'info_lines',
  'info empty lines');
select is(admin._mading_reject_reason('info', '{"lines":["a"],"accent":"mustard"}'::jsonb), 'info_title',
  'info missing title');
select is(admin._mading_reject_reason('data', '{"title":"T","headers":["H1","H2"],"rows":[["a"]]}'::jsonb), 'data_row_shape',
  'data row length != headers');
select is(admin._mading_reject_reason('data', '{"title":"T","headers":["H1","H2"],"align":["left"],"rows":[["a","b"]]}'::jsonb), 'data_align',
  'data align length != headers');
select is(admin._mading_reject_reason('data', '{"title":"T","headers":[],"rows":[]}'::jsonb), 'data_headers',
  'data empty headers');
select is(admin._mading_reject_reason('knowledge', '{"kind":"quote","text":"x"}'::jsonb), 'knowledge_kind',
  'knowledge unknown kind');
select is(admin._mading_reject_reason('knowledge', '{"kind":"stat","label":"L"}'::jsonb), 'knowledge_stat_fields',
  'knowledge stat missing value');
select is(admin._mading_reject_reason('knowledge', '{"kind":"fact","text":"  "}'::jsonb), 'knowledge_fact_text',
  'knowledge fact empty text');
select is(admin._mading_reject_reason('knowledge', '{"kind":"fact","text":"t","chip":"Lainnya"}'::jsonb), 'knowledge_chip',
  'knowledge bad chip');
select is(admin._mading_reject_reason('identitas', '{"nama":"N","badanHukum":"B","alamat":"A"}'::jsonb), 'identitas_fields',
  'identitas missing field');
select is(admin._mading_reject_reason('info', '["not","object"]'::jsonb), 'payload_not_object',
  'payload not an object');

-- ── upsert: create ──────────────────────────────────────────────────────────────────────────
create temporary table up_create as select admin.upsert_mading_block(
  null, 'info', 'new-info', '{"title":"New","lines":["a","b"],"accent":"mustard"}'::jsonb, 1, null) as r;
select is((select (r->>'ok')::boolean from up_create), true, 'create info: ok');
select is(jsonb_array_length(admin.list_mading() #> '{groups,info}'), 2, 'create info: list now 2 info blocks');

select is((admin.upsert_mading_block(null, 'info', 'seed-info', '{"title":"Dup","lines":["a"],"accent":"mustard"}'::jsonb, 0, null) ->> 'reason'),
  'duplicate_key', 'create duplicate (board,block_key) → duplicate_key');
select is((admin.upsert_mading_block(null, 'identitas', 'other', '{"nama":"N","badanHukum":"B","alamat":"A","desa":"D"}'::jsonb, 0, null) ->> 'reason'),
  'identitas_exists', 'create second identitas → identitas_exists (partial unique caught)');
select is((admin.upsert_mading_block(null, 'bogus', 'k', '{"title":"T","lines":["a"],"accent":"mustard"}'::jsonb, 0, null) ->> 'reason'),
  'unknown_board', 'create unknown board → unknown_board');
select is((admin.upsert_mading_block(null, 'info', 'k2', '{"title":"T","lines":["a"],"accent":"neon"}'::jsonb, 0, null) ->> 'reason'),
  'info_accent', 'create invalid payload → payload reason');
select is((admin.upsert_mading_block(null, 'info', 'k3', '{"title":"T","lines":["a"],"accent":"mustard"}'::jsonb, -1, null) ->> 'reason'),
  'sort_order_negative', 'create negative sort_order → sort_order_negative');

-- ── upsert: edit (compare-and-swap) ───────────────────────────────────────────────────────────
create temporary table up_edit as select admin.upsert_mading_block(
  (select id from public.mading_block where board='info' and block_key='seed-info'),
  null, null,
  '{"title":"Edited","lines":["z"],"accent":"orange"}'::jsonb, 0,
  (select updated_at from public.mading_block where board='info' and block_key='seed-info')) as r;
select is((select (r->>'ok')::boolean from up_edit), true, 'edit seed-info: ok');
select is((select payload->>'title' from public.mading_block where board='info' and block_key='seed-info'), 'Edited',
  'edit seed-info: payload updated');
select is((admin.upsert_mading_block(
  (select id from public.mading_block where board='data' and block_key='seed-data'),
  null, null, '{"title":"X","headers":["H"],"rows":[["a"]]}'::jsonb, 0, 'epoch'::timestamptz) ->> 'reason'),
  'stale_write', 'edit with stale CAS token → stale_write');
select is((admin.upsert_mading_block(
  gen_random_uuid(), null, null, '{"title":"X","headers":["H"],"rows":[["a"]]}'::jsonb, 0, now()) ->> 'reason'),
  'not_found', 'edit unknown id → not_found');

-- ── delete ────────────────────────────────────────────────────────────────────────────────────
create temporary table del_ok as select admin.delete_mading_block(
  (select id from public.mading_block where board='info' and block_key='new-info')) as r;
select is((select (r->>'deleted')::boolean from del_ok), true, 'delete new-info: deleted=true');
select is((select count(*)::int from public.mading_block where board='info' and block_key='new-info'), 0,
  'delete new-info: row removed');
select is((admin.delete_mading_block(gen_random_uuid()) ->> 'reason'), 'not_found',
  'delete unknown id → not_found');

select * from finish();
rollback;
