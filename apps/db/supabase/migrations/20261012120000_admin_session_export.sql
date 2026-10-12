-- Admin reporting / CSV export (SIM-19). NO new tables, NO changes to game tables, NO trigger on
-- the game write path — one more SECURITY DEFINER read function in the `admin` schema, returning
-- per-session result ROWS (one jsonb array, built server-side) for an offline CSV. Reachable only
-- by the existing least-privilege `metrics_reader` role (EXECUTE-only); admin-ness is enforced at
-- the backend (require_role). Returns NO PII (no user_id/display_name) — session_id is an opaque
-- UUID join key, kept non-identifying by the admin gate, exactly like the other admin surfaces.
--
-- Defensive, same invariants as metrics_overview()/scenario_analytics(): ended (completed) sessions
-- only; per-session rubric mean over object-guarded + numeric + in-range (0..100) values only (one
-- poisoned client row must not 503 the export); timestamps + numbers formatted IN SQL so the backend
-- only quotes/concatenates. `coalesce(jsonb_agg(...), '[]')` is load-bearing: the result is NEVER SQL
-- NULL, so the backend's shared `row is None → MetricsUnavailable` fail-soft guard never misfires on
-- an empty export (empty = a valid 200 header-only CSV).

-- Serves the ?from/?to range scan over COMPLETED rows: the only index whose leading column is
-- started_at among completed sessions. Writes don't touch it on the hot path — sessions are INSERTed
-- with ended_at NULL (the START row), so a row enters this partial index only on the
-- record_session_result finalize UPDATE (one entry per completed session), never on /token. For the
-- NO-filter export the planner will seq-scan + sort regardless (all columns come from the heap); the
-- index earns its keep on narrow date ranges against a large table.
-- NOTE: `if not exists` guards on NAME only; if this index's columns/predicate ever change, rename it
-- or drop-and-recreate — reusing the name silently no-ops.
create index if not exists sessions_ended_started_idx
  on public.sessions (started_at)
  where ended_at is not null;

-- NOTE: changing any key/type in the jsonb row objects below after ship requires a `drop function`
-- first — `create or replace` cannot change a function's return type (here it stays jsonb, so edits
-- to the inner object shape are fine, but a future switch to `returns table(...)` would need a drop).
create or replace function admin.session_results_export(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'session_id',       s.id::text,                  -- opaque UUID, not PII
        'scenario_id',      s.scenario_id,
        'scenario_title',   sd.title,
        'started_at',       to_char(s.started_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'ended_at',         to_char(s.ended_at   at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'duration_seconds', extract(epoch from (s.ended_at - s.started_at))::bigint,  -- >= 0 (CHECK ended_at >= started_at)
        'trigger',          s.trigger,
        'ending_type',      s.ending_type,
        -- per-session rubric mean — SAME object-guard + CASE-gated ::numeric cast + 0..100 range-guard
        -- as metrics_overview()/scenario_analytics() so the per-session number matches the dashboard
        -- formula. OUTER object-guard is REQUIRED: jsonb_each() RAISES on a top-level non-object
        -- (array/scalar/JSON 'null') — one poisoned row would otherwise 503 the whole export.
        'avg_score', round((
          select avg(num)
          from (
            select case when jsonb_typeof(v.value) = 'number' then (v.value)::numeric end as num
            from jsonb_each(case when jsonb_typeof(s.scores_json) = 'object'
                                 then s.scores_json else '{}'::jsonb end) v
          ) t
          where num between 0 and 100
        ), 1)
      )
      order by s.started_at asc, s.id asc   -- deterministic; ORDER BY lives INSIDE jsonb_agg (a CTE ORDER BY need not survive into the aggregate)
    ),
    '[]'::jsonb                             -- empty export → [] (never SQL NULL → backend fail-soft stays correct)
  )
  from public.sessions s
  -- INNER join is safe: sessions.scenario_id is NOT NULL with an FK to scenario_definition(code) and
  -- no ON DELETE action (RESTRICT), so every session has exactly one definition — it can never drop a
  -- row. Title only; deliberately NOT status-filtered, so completed sessions for a COMING_SOON/renamed
  -- scenario still export.
  join public.scenario_definition sd on sd.code = s.scenario_id
  where s.ended_at is not null                                              -- completed only; OPEN rows excluded
    and (p_from is null or s.started_at >= (p_from)::timestamp at time zone 'utc')      -- UTC-anchored lower bound
    and (p_to   is null or s.started_at <  (p_to + 1)::timestamp at time zone 'utc');   -- half-open: to-day inclusive; from>to → 0 rows
$$;

-- RLS-bypass invariant self-documenting (don't rely on "migration runs as postgres").
alter function admin.session_results_export(date, date) owner to postgres;

-- ── grant matrix (same discipline as metrics_overview/scenario_analytics; all five statements so the
-- migration is self-contained) ─────────────────────────────────────────────────────────────────────
-- `revoke ... from public` alone is NOT enough: Supabase default-privileges grant EXECUTE to
-- anon/authenticated — revoke from them explicitly, then grant ONLY to metrics_reader.
revoke all on schema admin from public;                                     -- idempotent (also in SIM-15)
revoke all on function admin.session_results_export(date, date) from public, anon, authenticated;
grant usage on schema admin to metrics_reader;                              -- idempotent (also in SIM-15)
grant execute on function admin.session_results_export(date, date) to metrics_reader;
alter default privileges in schema admin revoke execute on functions from public, anon, authenticated;
