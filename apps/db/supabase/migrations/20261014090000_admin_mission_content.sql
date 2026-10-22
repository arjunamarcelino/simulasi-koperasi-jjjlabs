-- Admin-managed mission unlock codes (SIM-42). Adds a RUNTIME write path to
-- public.mission_definition.redeem_code (previously writable only by the generated
-- seed / raw SQL) plus an admin-only READ that exposes the hidden reallife codes for
-- editing. Mirrors the SIM-18 quiz pattern: admin.* SECURITY DEFINER functions, owner
-- postgres, EXECUTE granted ONLY to metrics_reader; the backend enforces
-- require_role('admin').
--
-- Credential blast radius (as SIM-17/18): metrics_reader now also rotates reallife codes
-- through these postgres-owned functions. It holds NO direct table privilege; a leaked
-- METRICS_DB_URL enables admin-gated code rotation only. require_role('admin') is the
-- control. INVARIANT: the `admin` schema must NEVER be added to PostgREST's exposed
-- schemas, and these migrations must NOT touch public.mission_catalog (the codes must
-- stay hidden from anon/authenticated).
--
-- Error contract (load-bearing): metrics_db._call_definer turns ANY raised exception into
-- a 503. So every EXPECTED outcome is a STRUCTURED RETURN ({ok, reason}), never a RAISE —
-- the FastAPI route maps reason → HTTP status (404/422). RAISE is reserved for true
-- invariants (a bug), which correctly surface as 503.
--
-- Deliberate divergences from the quiz template:
--   1. No CAS token / last-write-wins — tiny admin set, rare rotations; the audit columns
--      record who/when. No prev_updated_at param, no stale_write/409.
--   2. Audit, not concurrency — redeem_code_updated_at/_by are nullable with NO default
--      (NULL = "never rotated via admin since seed"); a default now() would falsely assert
--      every seeded row was rotated at migration time.
--   3. Rotate-only — no create/delete of missions; `code` (mission id) is the immutable
--      key, redeem_code the only editable field; the read lists kind='reallife' only.
--   4. No FK on redeem_code_updated_by — it is an audit tombstone (actor integrity is
--      enforced server-side: the backend supplies the JWT-verified admin user_id); an FK
--      into auth.users would couple admin deletion to the audit trail.

-- ── audit columns: nullable, no default (NULL = never rotated via admin since seed) ──────
alter table public.mission_definition
  add column if not exists redeem_code_updated_at timestamptz,
  add column if not exists redeem_code_updated_by uuid;

-- ── admin read: reallife rows INCLUDING the hidden redeem_code + audit ───────────────────
-- The client reads public.mission_catalog (which omits redeem_code); admins must edit it,
-- so this definer read returns the full reallife row. STABLE; one jsonb round-trip;
-- deterministic order so the admin table render is stable. Game missions (null code) are
-- excluded — nothing to rotate.
create or replace function admin.list_missions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', m.code,
               'title', m.title,
               'redeem_code', m.redeem_code,
               -- audit timestamps are display-only here (no CAS token), but keep the quiz
               -- microsecond-UTC format for cross-surface consistency.
               'redeem_code_updated_at', to_char(m.redeem_code_updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'redeem_code_updated_by', m.redeem_code_updated_by
             ) order by m.sort_order, m.code)
      from public.mission_definition m where m.kind = 'reallife'), '[]'::jsonb)
  );
$$;

-- ── admin write: rotate redeem_code on an existing reallife mission (VOLATILE) ───────────
-- Last-write-wins: one atomic UPDATE sets the code and both audit columns together, so
-- there is no partial-write window. Guards below are defense-in-depth so a direct/edge call
-- can never RAISE the table CHECK (mission_reallife_has_code / mission_redeem_code_nonblank)
-- into a 503. The `kind='reallife'` predicate means a game or unknown code matches 0 rows →
-- not_found (collapses unknown + game into one reason, no info leak). btrim-on-write mirrors
-- claim_mission's lower(btrim()) match semantics so a stored stray space never confuses.
create or replace function admin.set_mission_redeem_code(p_code text, p_redeem_code text, p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := btrim(p_redeem_code);
  v_row  public.mission_definition;
begin
  if v_code is null or v_code = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty_redeem_code');
  end if;
  if char_length(v_code) > 64 then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;

  update public.mission_definition
     set redeem_code            = v_code,
         redeem_code_updated_at = now(),
         redeem_code_updated_by = p_actor
   where code = p_code and kind = 'reallife'
   returning * into v_row;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'row', jsonb_build_object(
             'code', v_row.code,
             'title', v_row.title,
             'redeem_code', v_row.redeem_code,
             'redeem_code_updated_at', to_char(v_row.redeem_code_updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'redeem_code_updated_by', v_row.redeem_code_updated_by
           )
  );
end;
$$;

-- ── ownership (RLS-bypass invariant, self-documenting) ───────────────────────────────────
alter function admin.list_missions()                                owner to postgres;
alter function admin.set_mission_redeem_code(text, text, uuid)      owner to postgres;

-- ── grant matrix ─────────────────────────────────────────────────────────────────────────
-- The per-function revoke from public/anon/authenticated is the real guarantee (`from public`
-- alone is NOT enough — the SIM-5 default-privilege trap); EXECUTE only to metrics_reader.
revoke all on schema admin from public;                             -- idempotent
revoke all on function admin.list_missions()                           from public, anon, authenticated;
revoke all on function admin.set_mission_redeem_code(text, text, uuid) from public, anon, authenticated;
grant usage on schema admin to metrics_reader;                      -- idempotent
grant execute on function admin.list_missions()                           to metrics_reader;
grant execute on function admin.set_mission_redeem_code(text, text, uuid) to metrics_reader;
alter default privileges in schema admin revoke execute on functions from public, anon, authenticated;
