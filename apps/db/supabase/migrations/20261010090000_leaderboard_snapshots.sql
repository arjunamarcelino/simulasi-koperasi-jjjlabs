-- Seasonal XP-snapshot leaderboard (SIM-17). UNLIKE SIM-15/16 (which added NO tables), this
-- feature introduces TWO tables that store FROZEN, point-in-time standings, plus the first
-- DESTRUCTIVE (write/delete) functions in the `admin` schema.
--
-- Design (see docs/plans/2026-10-09-feat-seasonal-xp-leaderboard-snapshot-plan.md):
-- - Ranking is by cumulative public.user_progress.xp (server-credited; NEVER the client-authored
--   sessions.scores_json). An admin manually "captures" the current standings into a new season.
-- - Admin dashboard reads admin.leaderboard_overview() (list + selected season) via metrics_reader.
-- - In-game "mading" reads public.leaderboard_current() (latest season, top 20) — granted
--   anon/authenticated like public.leaderboard(). It NEVER returns user_id.
--
-- Credential blast radius (IMPORTANT — this DIFFERS from the SIM-15 header): metrics_reader now
-- executes INSERT (capture) and cascade-DELETE (delete) through these SECURITY DEFINER functions.
-- The role still holds NO direct table privileges (the write runs with the postgres-owned
-- function's rights), but a leaked METRICS_DB_URL now enables admin-gated writes/deletes, not just
-- read-only aggregates. Admin-ness is enforced at the backend (require_role('admin')).
--
-- INVARIANT: the `admin` schema must NEVER be added to PostgREST's exposed schemas — doing so
-- would make capture/delete anon-reachable RPCs regardless of the backend gate.

-- ── tables ─────────────────────────────────────────────────────────────────────────────
-- A season = one frozen standing. season_number is the human-friendly, gapless, monotonic key
-- (NOT captured_at) — "latest" is always max(season_number). entry_count is written in the same
-- transaction as the entries (from row_count) and never recomputed; entries are insert-once and
-- immutable, so it cannot drift.
create table public.leaderboard_seasons (
  id            uuid primary key default gen_random_uuid(),
  season_number int  not null unique check (season_number > 0),
  label         text check (label is null or char_length(label) <= 120),
  captured_at   timestamptz not null default now(),
  entry_count   int  not null default 0 check (entry_count >= 0)
);

-- A frozen entry. display_name/xp/level/rank are self-contained (read paths never join back).
-- rank is 1-based contiguous (UNIQUE(season_id, rank) is the hard backstop + serves the read).
-- user_id is ADMIN-ONLY (to identify the real account behind a row); public.leaderboard_current()
-- never projects it.
--
-- DELIBERATE: user_id is NULLABLE with ON DELETE SET NULL, NOT the on-delete-cascade every other
-- identity FK in this repo uses. A snapshot is frozen history — deleting a player must preserve
-- their past standings (name/xp/level/rank), only nulling the back-reference. Do not "fix" this to
-- cascade.
create table public.leaderboard_entries (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references public.leaderboard_seasons(id) on delete cascade,
  rank         int  not null check (rank >= 1),
  user_id      uuid references public.profiles(id) on delete set null,
  display_name text not null,
  xp           int  not null check (xp >= 0),
  level        int  not null,
  unique (season_id, rank)
);
-- FK-covering index: without it, a profile deletion (ON DELETE SET NULL) seq-scans + locks the
-- entries table. The UNIQUE(season_id, rank) above already serves the (season_id, rank) read path.
create index leaderboard_entries_user_id_idx on public.leaderboard_entries (user_id);

-- ── RLS: reachable ONLY via the SECURITY DEFINER functions below ─────────────────────────
-- RLS on + NO client policies ⇒ anon/authenticated fully denied. The explicit revoke is REQUIRED
-- (Supabase default-privileges grant to anon/authenticated independently of PUBLIC — SIM-5 trap).
alter table public.leaderboard_seasons enable row level security;
alter table public.leaderboard_entries enable row level security;
revoke all on table public.leaderboard_seasons from anon, authenticated, public;
revoke all on table public.leaderboard_entries from anon, authenticated, public;

-- ── latest-season helper (shared so the public board and admin preview never disagree) ───
-- Internal: called only inside the definer functions below (which run as postgres), so it needs
-- no external EXECUTE grant.
create or replace function admin._latest_season_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.leaderboard_seasons order by season_number desc limit 1;
$$;

-- ── capture: freeze current standings into a new season (VOLATILE — it WRITES) ───────────
create or replace function admin.capture_leaderboard_snapshot(p_label text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_season_id     uuid;
  v_season_number int;
  v_captured_at   timestamptz;
  v_count         int;
begin
  -- Serialize captures so two concurrent calls can't compute the same season_number. xact-scoped:
  -- auto-released on commit/rollback (pooler-safe, cannot leak). UNIQUE(season_number) is the hard
  -- backstop; this lock just turns a collision into an orderly wait instead of a unique violation.
  perform pg_advisory_xact_lock(hashtext('leaderboard_capture'));

  select coalesce(max(season_number), 0) + 1
    into v_season_number
    from public.leaderboard_seasons;

  insert into public.leaderboard_seasons (season_number, label)
  values (v_season_number, nullif(btrim(p_label), ''))
  returning id, captured_at into v_season_id, v_captured_at;

  -- The outer ORDER BY MUST match the row_number() window ORDER BY exactly, or the LIMIT 100 cut
  -- selects a different set than the ranks number — breaking "contiguous 1..N" at a tie boundary.
  -- The tuple is a TOTAL order (updated_at is NOT NULL; user_id is the PK), so ranks are
  -- deterministic. Tie-break semantics: least-recently-updated first, then user_id.
  insert into public.leaderboard_entries (season_id, rank, user_id, display_name, xp, level)
  select
    v_season_id,
    row_number() over (order by up.xp desc, up.updated_at asc, up.user_id),
    up.user_id,
    coalesce(nullif(btrim(p.display_name), ''), 'Anggota'),
    up.xp,
    public.level_from_xp(up.xp)
  from public.user_progress up
  join public.profiles p on p.id = up.user_id
  where up.xp > 0
  order by up.xp desc, up.updated_at asc, up.user_id
  limit 100;

  get diagnostics v_count = row_count;                      -- count the rows actually inserted
  update public.leaderboard_seasons set entry_count = v_count where id = v_season_id;

  -- Empty / all-zero-XP player base is allowed: a valid season with entry_count 0.
  return jsonb_build_object(
    'season_id', v_season_id,
    'season_number', v_season_number,
    'captured_at', to_char(v_captured_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'entry_count', v_count
  );
end;
$$;

-- ── delete: drop a season (cascades to its entries). Returns deleted:false on absent, never ──
-- raises — the backend maps {deleted:false} to HTTP 404 (a raise would be swallowed by the
-- fail-soft broad-except into a misleading 503).
create or replace function admin.delete_leaderboard_season(p_season_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_season_number int;
begin
  delete from public.leaderboard_seasons
   where id = p_season_id
  returning season_number into v_season_number;

  if not found then
    return jsonb_build_object('deleted', false, 'season_number', null);
  end if;
  return jsonb_build_object('deleted', true, 'season_number', v_season_number);
end;
$$;

-- ── overview: ONE jsonb (seasons list + selected season's entries), one round-trip ───────
-- The seasons array is intentionally re-returned on every call (cheap; entry_count avoids a join)
-- and capped at 50 — it lives in a frozen contract, so adding the limit later would be a change.
-- p_season_id null → latest. selected is null when no season exists.
create or replace function admin.leaderboard_overview(p_season_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with sel as (select coalesce(p_season_id, admin._latest_season_id()) as id)
  select jsonb_build_object(
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'season_number', s.season_number,
               'label', s.label,
               'captured_at', to_char(s.captured_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'entry_count', s.entry_count
             ) order by s.season_number desc)
      from (
        select id, season_number, label, captured_at, entry_count
        from public.leaderboard_seasons
        order by season_number desc
        limit 50
      ) s), '[]'::jsonb),
    'selected', (
      select jsonb_build_object(
               'id', s.id,
               'season_number', s.season_number,
               'label', s.label,
               'captured_at', to_char(s.captured_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'entry_count', s.entry_count,
               'entries', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'rank', e.rank,
                          'display_name', e.display_name,
                          'xp', e.xp,
                          'level', e.level
                        ) order by e.rank)
                 from public.leaderboard_entries e
                 where e.season_id = s.id), '[]'::jsonb)
             )
      from public.leaderboard_seasons s
      where s.id = (select id from sel)
    )
  );
$$;

-- ── public game read: latest season, top 20, display-only (NEVER user_id) ────────────────
-- Explicit column list + RETURNS TABLE makes leaking user_id structurally impossible.
create or replace function public.leaderboard_current()
returns table (display_name text, xp int, level int, rank int)
language sql stable security definer set search_path = '' as $$
  select e.display_name, e.xp, e.level, e.rank
  from public.leaderboard_entries e
  where e.season_id = admin._latest_season_id()
  order by e.rank
  limit 20;
$$;

-- ── ownership (RLS-bypass invariant self-documenting) ────────────────────────────────────
alter function admin._latest_season_id()                 owner to postgres;
alter function admin.capture_leaderboard_snapshot(text)  owner to postgres;
alter function admin.delete_leaderboard_season(uuid)      owner to postgres;
alter function admin.leaderboard_overview(uuid)           owner to postgres;
alter function public.leaderboard_current()               owner to postgres;

-- ── grant matrix ─────────────────────────────────────────────────────────────────────────
-- admin.* : revoke from public/anon/authenticated (the per-function revoke is the real guarantee;
-- `from public` alone is NOT enough — SIM-5), grant EXECUTE only to metrics_reader. The internal
-- _latest_season_id needs no grant (called inside the definer functions, which run as postgres).
revoke all on schema admin from public;                                            -- idempotent
revoke all on function admin._latest_season_id()                from public, anon, authenticated;
revoke all on function admin.capture_leaderboard_snapshot(text)  from public, anon, authenticated;
revoke all on function admin.delete_leaderboard_season(uuid)      from public, anon, authenticated;
revoke all on function admin.leaderboard_overview(uuid)           from public, anon, authenticated;
grant usage on schema admin to metrics_reader;                                     -- idempotent
grant execute on function admin.capture_leaderboard_snapshot(text) to metrics_reader;
grant execute on function admin.delete_leaderboard_season(uuid)    to metrics_reader;
grant execute on function admin.leaderboard_overview(uuid)         to metrics_reader;
alter default privileges in schema admin revoke execute on functions from public, anon, authenticated;

-- public.leaderboard_current(): the one game-facing read, granted like public.leaderboard().
revoke execute on function public.leaderboard_current() from public;
grant execute on function public.leaderboard_current() to anon, authenticated;
