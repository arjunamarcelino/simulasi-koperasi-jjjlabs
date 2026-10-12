-- Admin content management for mading (SIM-18). One generic table holds all 4 board kinds
-- (info notes / data tables / knowledge cards / the identitas header) as a typed discriminator
-- (`board`) + a jsonb `payload`. Mading has NO hidden fields (unlike quiz's answer key), so the
-- learner read is a plain owner-privileged view; admin writes go through admin.* SECURITY DEFINER
-- fns granted only to metrics_reader (require_role('admin') is the backend control).
--
-- Error contract (as SIM-17/quiz): metrics_db._call_definer turns any RAISE into a 503, so every
-- expected rejection is a STRUCTURED RETURN {ok:false, reason, field?} — never a RAISE. Unique /
-- identitas-singleton violations are CAUGHT and returned as reasons.
--
-- Validation: the authoritative rich validation is Pydantic at the FastAPI boundary (→ 422). The
-- DB layer is a defense-in-depth FLOOR — the table CHECK (jsonb object) + admin._mading_reject_reason,
-- which is CLOSED (rejects foreign keys per board) and element-typed (every array element must be a
-- string; align ∈ {left,right}) to match the FE closed parsers. So the generated SEED (which writes
-- the table directly, bypassing Pydantic) and any future direct write cannot persist a payload the
-- learner parser would reject as `invalid`.

-- `if not exists` / `or replace` throughout so a partial-apply or manual re-run is safe (matches
-- the sibling quiz migration's idempotent style).
create table if not exists public.mading_block (
  id         uuid primary key default gen_random_uuid(),
  board      text not null check (board in ('info','data','knowledge','identitas')),
  block_key  text not null check (char_length(btrim(block_key)) > 0),
  payload    jsonb not null check (jsonb_typeof(payload) = 'object'),
  sort_order int  not null default 0 check (sort_order >= 0),
  updated_at timestamptz not null default now(),
  unique (board, block_key)
);
-- identitas is a single header row (one per koperasi) — enforce it structurally, not by convention.
create unique index if not exists mading_block_identitas_singleton
  on public.mading_block (board) where board = 'identitas';
-- Hot learner read path: filter by board, order by sort_order.
create index if not exists mading_block_board_sort_idx on public.mading_block (board, sort_order);

-- RLS on + revoke (incl public — the SIM-5 default-privilege trap): the base table is reachable
-- only through the fns/view below.
alter table public.mading_block enable row level security;
revoke all on table public.mading_block from anon, authenticated, public;

-- Learner read: a plain owner-privileged view (no hidden fields → a view, not a definer fn), granted
-- SELECT-only to anon/authenticated. NEVER grant INSERT/UPDATE/DELETE on it.
create or replace view public.mading_catalog as
  select board, block_key, payload, sort_order from public.mading_block;
grant select on public.mading_catalog to anon, authenticated;

-- ── validation floor: returns a machine reason or NULL (valid). Mirrors the FE/Pydantic contract.
-- Uses `is distinct from` (NULL-safe): a missing key → jsonb_typeof NULL → distinct from 'string' → reject.
create or replace function admin._mading_reject_reason(p_board text, p_payload jsonb)
returns text language plpgsql immutable security definer set search_path = '' as $$
declare
  v_headers_len int;
  v_row jsonb;
  v_kind text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return 'payload_not_object';
  end if;

  -- The floor is CLOSED and element-typed to match the FE closed parsers + Pydantic extra="forbid":
  -- reject foreign keys per board, and require every array element be a string. So a direct/seed
  -- write cannot persist a payload the learner parser would later reject as `invalid`.
  if p_board = 'identitas' then
    if exists (select 1 from jsonb_object_keys(p_payload) k
                where k <> all (array['nama', 'badanHukum', 'alamat', 'desa'])) then
      return 'foreign_key';
    end if;
    if jsonb_typeof(p_payload -> 'nama') is distinct from 'string'
       or jsonb_typeof(p_payload -> 'badanHukum') is distinct from 'string'
       or jsonb_typeof(p_payload -> 'alamat') is distinct from 'string'
       or jsonb_typeof(p_payload -> 'desa') is distinct from 'string'
       or char_length(btrim(coalesce(p_payload ->> 'nama', ''))) = 0
       or char_length(btrim(coalesce(p_payload ->> 'badanHukum', ''))) = 0
       or char_length(btrim(coalesce(p_payload ->> 'alamat', ''))) = 0
       or char_length(btrim(coalesce(p_payload ->> 'desa', ''))) = 0 then
      return 'identitas_fields';
    end if;
    return null;

  elsif p_board = 'info' then
    if exists (select 1 from jsonb_object_keys(p_payload) k
                where k <> all (array['title', 'lines', 'accent'])) then
      return 'foreign_key';
    end if;
    if jsonb_typeof(p_payload -> 'title') is distinct from 'string'
       or char_length(btrim(coalesce(p_payload ->> 'title', ''))) = 0 then
      return 'info_title';
    end if;
    if jsonb_typeof(p_payload -> 'lines') is distinct from 'array'
       or jsonb_array_length(p_payload -> 'lines') = 0
       or exists (select 1 from jsonb_array_elements(p_payload -> 'lines') e
                   where jsonb_typeof(e) <> 'string') then
      return 'info_lines';
    end if;
    if (p_payload ->> 'accent') is null
       or (p_payload ->> 'accent') not in ('mustard', 'forest', 'orange', 'parchment') then
      return 'info_accent';
    end if;
    return null;

  elsif p_board = 'data' then
    if exists (select 1 from jsonb_object_keys(p_payload) k
                where k <> all (array['title', 'caption', 'headers', 'align', 'rows'])) then
      return 'foreign_key';
    end if;
    if jsonb_typeof(p_payload -> 'title') is distinct from 'string'
       or char_length(btrim(coalesce(p_payload ->> 'title', ''))) = 0 then
      return 'data_title';
    end if;
    if (p_payload ? 'caption') and jsonb_typeof(p_payload -> 'caption') is distinct from 'string' then
      return 'data_caption';
    end if;
    if jsonb_typeof(p_payload -> 'headers') is distinct from 'array'
       or jsonb_array_length(p_payload -> 'headers') = 0
       or exists (select 1 from jsonb_array_elements(p_payload -> 'headers') e
                   where jsonb_typeof(e) <> 'string') then
      return 'data_headers';
    end if;
    v_headers_len := jsonb_array_length(p_payload -> 'headers');
    if (p_payload ? 'align')
       and (jsonb_typeof(p_payload -> 'align') is distinct from 'array'
            or jsonb_array_length(p_payload -> 'align') <> v_headers_len
            or exists (select 1 from jsonb_array_elements_text(p_payload -> 'align') a
                        where a not in ('left', 'right'))) then
      return 'data_align';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' then
      return 'data_rows';
    end if;
    for v_row in select value from jsonb_array_elements(p_payload -> 'rows') loop
      if jsonb_typeof(v_row) is distinct from 'array'
         or jsonb_array_length(v_row) <> v_headers_len
         or exists (select 1 from jsonb_array_elements(v_row) c where jsonb_typeof(c) <> 'string') then
        return 'data_row_shape';
      end if;
    end loop;
    return null;

  elsif p_board = 'knowledge' then
    v_kind := p_payload ->> 'kind';
    if v_kind = 'stat' then
      if exists (select 1 from jsonb_object_keys(p_payload) k
                  where k <> all (array['kind', 'value', 'label', 'group', 'sub'])) then
        return 'foreign_key';
      end if;
      if jsonb_typeof(p_payload -> 'value') is distinct from 'string'
         or jsonb_typeof(p_payload -> 'label') is distinct from 'string'
         or ((p_payload ? 'group') and jsonb_typeof(p_payload -> 'group') is distinct from 'string')
         or ((p_payload ? 'sub') and jsonb_typeof(p_payload -> 'sub') is distinct from 'string') then
        return 'knowledge_stat_fields';
      end if;
      return null;
    elsif v_kind = 'fact' then
      if exists (select 1 from jsonb_object_keys(p_payload) k
                  where k <> all (array['kind', 'text', 'chip'])) then
        return 'foreign_key';
      end if;
      if jsonb_typeof(p_payload -> 'text') is distinct from 'string'
         or char_length(btrim(coalesce(p_payload ->> 'text', ''))) = 0 then
        return 'knowledge_fact_text';
      end if;
      if (p_payload ? 'chip')
         and (p_payload ->> 'chip') not in ('Prinsip Koperasi', 'Landasan Hukum') then
        return 'knowledge_chip';
      end if;
      return null;
    else
      return 'knowledge_kind';
    end if;
  end if;

  return 'unknown_board';
end;
$$;

-- ── admin read: all blocks grouped by board (incl the hidden id + CAS updated_at token) ──────────
create or replace function admin.list_mading()
returns jsonb language sql stable security definer set search_path = '' as $$
  with items as (
    select
      b.board,
      jsonb_build_object(
        'id', b.id,
        'block_key', b.block_key,
        'payload', b.payload,
        'sort_order', b.sort_order,
        'updated_at', to_char(b.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) as item,
      b.sort_order,
      b.block_key
    from public.mading_block b
  )
  select jsonb_build_object(
    'ok', true,
    'groups', jsonb_build_object(
      'info',      coalesce((select jsonb_agg(item order by sort_order, block_key) from items where board = 'info'), '[]'::jsonb),
      'data',      coalesce((select jsonb_agg(item order by sort_order, block_key) from items where board = 'data'), '[]'::jsonb),
      'knowledge', coalesce((select jsonb_agg(item order by sort_order, block_key) from items where board = 'knowledge'), '[]'::jsonb),
      'identitas', (select item from items where board = 'identitas' limit 1)
    )
  );
$$;

-- Small helper: build the {ok:true, row:{...}} envelope for a block identified by (board, block_key).
-- Defined before its caller (admin.upsert_mading_block) for readability.
create or replace function admin._mading_row(p_board text, p_block_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'row', jsonb_build_object(
      'id', b.id,
      'board', b.board,
      'block_key', b.block_key,
      'payload', b.payload,
      'sort_order', b.sort_order,
      'updated_at', to_char(b.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
  )
  from public.mading_block b
  where b.board = p_board and b.block_key = p_block_key;
$$;

-- ── admin upsert: create (p_id null) or compare-and-swap edit. board/block_key are set at CREATE
-- and immutable on EDIT (block_key is the stable seed key). (VOLATILE — it WRITES) ───────────────
create or replace function admin.upsert_mading_block(
  p_id              uuid,
  p_board           text,
  p_block_key       text,
  p_payload         jsonb,
  p_sort_order      int,
  p_prev_updated_at timestamptz default null
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reason text;
  v_board  text;
begin
  if p_sort_order is null or p_sort_order < 0 then
    return jsonb_build_object('ok', false, 'reason', 'sort_order_negative', 'field', 'sort_order');
  end if;

  if p_id is null then
    -- CREATE: board + block_key required and validated here.
    if p_board is null or p_board not in ('info', 'data', 'knowledge', 'identitas') then
      return jsonb_build_object('ok', false, 'reason', 'unknown_board', 'field', 'board');
    end if;
    if p_block_key is null or char_length(btrim(p_block_key)) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'block_key_empty', 'field', 'block_key');
    end if;
    v_reason := admin._mading_reject_reason(p_board, p_payload);
    if v_reason is not null then
      return jsonb_build_object('ok', false, 'reason', v_reason, 'field', 'payload');
    end if;
    begin
      insert into public.mading_block (board, block_key, payload, sort_order, updated_at)
      values (p_board, p_block_key, p_payload, p_sort_order, now());
    exception
      when unique_violation then
        -- either (board, block_key) collided or the identitas-singleton partial index fired
        if p_board = 'identitas' then
          return jsonb_build_object('ok', false, 'reason', 'identitas_exists');
        end if;
        return jsonb_build_object('ok', false, 'reason', 'duplicate_key', 'field', 'block_key');
    end;
    return admin._mading_row(p_board, p_block_key);
  else
    -- EDIT: resolve the stored board (payload is validated against it, not the client-sent board),
    -- then ATOMIC compare-and-swap. The token is folded INTO the UPDATE predicate so two concurrent
    -- edits on the same base token can't both win (the second matches 0 rows → stale_write), rather
    -- than a check-then-UPDATE that would let the second clobber the first under READ COMMITTED.
    select board into v_board from public.mading_block where id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    v_reason := admin._mading_reject_reason(v_board, p_payload);
    if v_reason is not null then
      return jsonb_build_object('ok', false, 'reason', v_reason, 'field', 'payload');
    end if;
    update public.mading_block
       set payload = p_payload, sort_order = p_sort_order, updated_at = now()
     where id = p_id
       and updated_at is not distinct from p_prev_updated_at;
    if not found then
      -- the row existed moments ago (select above), so a 0-row update means the token no longer
      -- matches → stale (or a concurrent delete, for which "reload" is also the right outcome).
      return jsonb_build_object('ok', false, 'reason', 'stale_write');
    end if;
    return (select admin._mading_row(b.board, b.block_key) from public.mading_block b where b.id = p_id);
  end if;
end;
$$;

-- ── admin delete: no learner-facing FK references mading_block, so no soft-block. Empty board OK. ──
create or replace function admin.delete_mading_block(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.mading_block where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'deleted', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'deleted', true);
end;
$$;

-- ── ownership ────────────────────────────────────────────────────────────────────────────
alter function admin._mading_reject_reason(text, jsonb)                      owner to postgres;
alter function admin._mading_row(text, text)                                 owner to postgres;
alter function admin.list_mading()                                           owner to postgres;
alter function admin.upsert_mading_block(uuid, text, text, jsonb, int, timestamptz) owner to postgres;
alter function admin.delete_mading_block(uuid)                               owner to postgres;

-- ── grant matrix: EXECUTE only to metrics_reader; the internal helpers need no external grant
-- (they run inside the definer fns, as postgres). The per-function revoke from public is the real
-- guarantee (SIM-5 trap). ───────────────────────────────────────────────────────────────────────
revoke all on schema admin from public;                                       -- idempotent
revoke all on function admin._mading_reject_reason(text, jsonb)                      from public, anon, authenticated;
revoke all on function admin._mading_row(text, text)                                 from public, anon, authenticated;
revoke all on function admin.list_mading()                                           from public, anon, authenticated;
revoke all on function admin.upsert_mading_block(uuid, text, text, jsonb, int, timestamptz) from public, anon, authenticated;
revoke all on function admin.delete_mading_block(uuid)                               from public, anon, authenticated;
grant usage on schema admin to metrics_reader;                                -- idempotent
grant execute on function admin.list_mading()                                           to metrics_reader;
grant execute on function admin.upsert_mading_block(uuid, text, text, jsonb, int, timestamptz) to metrics_reader;
grant execute on function admin.delete_mading_block(uuid)                               to metrics_reader;
alter default privileges in schema admin revoke execute on functions from public, anon, authenticated;
