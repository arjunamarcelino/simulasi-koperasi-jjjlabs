-- Admin analytics read path (SIM-15). NO new tables, NO changes to game tables.
-- A dedicated `admin` schema (kept OFF the PostgREST-exposed schemas), one SECURITY
-- DEFINER entry function that aggregates public.sessions + profiles + scenario_definition,
-- and a least-privilege `metrics_reader` login role the backend connects as.
--
-- Design (see docs/plans/2026-10-09-feat-admin-dashboard-metrics-plan.md):
-- - The deliberately DB-free backend (apps/backend) gains ONE fail-soft, read-only DB path.
-- - Admin-ness is enforced at the backend (require_role('admin')); the function is reachable
--   only by `metrics_reader` (EXECUTE-only, no table access), so no is_admin() RLS helper is
--   needed here. Credential blast radius is bounded: the function returns AGGREGATE-ONLY data
--   (counts, fractions, scenario titles) — never user_id/display_name/any row-level PII.
-- - Convention for future admin analytics: live in the `admin` schema, never add it to the
--   PostgREST exposed schemas, grant EXECUTE only to metrics_reader (NOT leaderboard()'s
--   `grant ... to authenticated`).

create schema if not exists admin;

-- ── metrics_reader: the backend's execute-only login role ───────────────────────────
-- CREATE ROLE is NOT idempotent (and roles are cluster-global, surviving `db reset`) → guard.
-- Null password: cannot authenticate until set out-of-band (CI/local throwaway; hosted secret).
-- CONNECTION LIMIT must exceed (pool max_size × backend instances) + the CI e2e's own slot;
-- 10 leaves headroom over the backend pool's max_size=5. No elevated attributes.
do $$
begin
  if not exists (select from pg_roles where rolname = 'metrics_reader') then
    create role metrics_reader login noinherit connection limit 10;  -- no password (null)
  end if;
end $$;

-- ── entry function: one jsonb overview (one round-trip, pooler-friendly) ─────────────
-- Owner = postgres (table-owner ⇒ bypasses RLS, repo convention cf. public.leaderboard).
-- Defensive throughout: ended sessions only; object+numeric+in-range rubric values only;
-- NULLIF every ratio; numbers built IN jsonb (avoids asyncpg Decimal); avg rounded in SQL;
-- ORDER BY inside jsonb_agg (a CTE ORDER BY is not guaranteed to survive into the aggregate).
create or replace function admin.metrics_overview()
returns jsonb language sql stable security definer set search_path = '' as $$
  with ended as (
    select user_id, scenario_id, ended_at, trigger, ending_type, scores_json
    from public.sessions
    where ended_at is not null                      -- ignore OPEN rows (schema permits them)
  ),
  -- Per-session mean over NUMERIC, IN-RANGE rubric values only. The OUTER object-guard is
  -- REQUIRED: jsonb_each() RAISES on a top-level non-object (array/scalar/JSON 'null'), and
  -- record_session only coalesces SQL NULL (not JSON 'null') with no object check — one poisoned
  -- client row would otherwise crash the whole function (503 for every admin).
  session_score as (
    select s.scenario_id, s.ending_type, s.trigger,
           case when jsonb_typeof(s.scores_json) = 'object' then
             -- CASE-gates the ::numeric cast behind the 'number' check so a non-numeric value
             -- (e.g. "high") is NEVER cast (WHERE does NOT guarantee short-circuit order → casting
             -- in a WHERE qual raises "cannot cast jsonb string to type numeric"). Range-guard the
             -- client-authored value in the outer WHERE on the already-safe numeric.
             (select avg(num)
                from (select case when jsonb_typeof(v.value) = 'number'
                                  then (v.value)::numeric end as num
                      from jsonb_each(s.scores_json) v) t
               where num between 0 and 100)
           end as score                                      -- null when non-object / no numeric keys
    from ended s
  ),
  overall as (
    select
      count(*)                                                              as total,
      count(*) filter (where trigger <> 'force_quit_level_2')::numeric
        / nullif(count(*), 0)                                               as completion_rate,
      count(*) filter (where ending_type = 'good')::numeric    / nullif(count(*), 0) as good,
      count(*) filter (where ending_type = 'neutral')::numeric / nullif(count(*), 0) as neutral,
      count(*) filter (where ending_type = 'bad')::numeric     / nullif(count(*), 0) as bad,
      round(avg(score), 1)                                                  as avg_score
    from session_score
  ),
  per_scenario as (
    select sd.code as scenario_id, sd.title,
           count(ss.scenario_id)                                                     as sessions,
           count(ss.scenario_id) filter (where ss.trigger <> 'force_quit_level_2')::numeric
             / nullif(count(ss.scenario_id), 0)                                      as completion_rate,
           count(ss.scenario_id) filter (where ss.ending_type = 'good')::numeric
             / nullif(count(ss.scenario_id), 0)                                      as good,
           count(ss.scenario_id) filter (where ss.ending_type = 'neutral')::numeric
             / nullif(count(ss.scenario_id), 0)                                      as neutral,
           count(ss.scenario_id) filter (where ss.ending_type = 'bad')::numeric
             / nullif(count(ss.scenario_id), 0)                                      as bad,
           round(avg(ss.score), 1)                                                   as avg_score
    from public.scenario_definition sd
    left join session_score ss on ss.scenario_id = sd.code         -- zero-session scenarios survive
    where sd.status = 'AVAILABLE'                                  -- hide COMING_SOON (no sessions ever)
    group by sd.code, sd.title
  )
  select jsonb_build_object(
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'users', jsonb_build_object(
      -- single FILTER over the already-materialized `ended` CTE (no second scan, no correlated
      -- EXISTS → no O(n^2)); keys off the server-stamped ended_at (stable), not client started_at.
      'active_30d', (select count(distinct user_id) filter (where ended_at >= now() - interval '30 days')
                       from ended),
      'total_registered', (select count(*) from public.profiles),
      'new_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days')
    ),
    'sessions', (select jsonb_build_object(
        'total', total,
        'completion_rate', completion_rate,
        'ending_split', case when total = 0 then null
                             else jsonb_build_object('good', good, 'neutral', neutral, 'bad', bad) end,
        'avg_score', avg_score) from overall),
    'per_scenario', coalesce((select jsonb_agg(jsonb_build_object(
        'scenario_id', scenario_id, 'title', title, 'sessions', sessions,
        'completion_rate', completion_rate,
        'ending_split', case when sessions = 0 then null
                             else jsonb_build_object('good', good, 'neutral', neutral, 'bad', bad) end,
        'avg_score', avg_score) order by title) from per_scenario), '[]'::jsonb)
  );
$$;

-- Make the RLS-bypass invariant self-documenting (don't rely on "migration runs as postgres").
alter function admin.metrics_overview() owner to postgres;

-- ── grant matrix ─────────────────────────────────────────────────────────────────────
-- The per-function revoke is the REAL guarantee. `revoke ... from public` alone is NOT enough:
-- Supabase default-privileges grant EXECUTE to anon/authenticated (SIM-5 learning), so revoke
-- from them explicitly, then grant ONLY to metrics_reader. `alter default privileges` below is
-- belt-and-suspenders (it only covers future functions created by this same role).
revoke all on schema admin from public;
revoke all on function admin.metrics_overview() from public, anon, authenticated;
grant usage on schema admin to metrics_reader;
grant execute on function admin.metrics_overview() to metrics_reader;
alter default privileges in schema admin revoke execute on functions from public, anon, authenticated;
