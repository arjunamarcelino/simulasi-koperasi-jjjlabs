-- Per-scenario analytics drill-down (SIM-16). NO new tables, NO changes to game tables,
-- NO trigger on the game write path — one more SECURITY DEFINER read function in the `admin`
-- schema, aggregating public.sessions LIVE (single-koperasi volume; strictly cheaper than the
-- all-scenario metrics_overview()). Reachable only by the existing least-privilege
-- `metrics_reader` role (EXECUTE-only); admin-ness is enforced at the backend (require_role).
--
-- Returns the frozen GET /admin/scenarios/{id}/analytics contract (apps/backend/CONTRACT.md):
-- outcome breakdown (COUNTS), per-pillar score distribution (5 buckets), avg_score; dropoff=null
-- (the event-log module is a separate follow-up ticket).
--
-- Defensive, same invariants as metrics_overview(): ended sessions only; object+numeric+in-range
-- rubric values only (one poisoned client row must not 503 the drill-down); numbers built IN jsonb
-- (avoids asyncpg Decimal); avg rounded in SQL; pillar keys discovered dynamically (per-scenario
-- rubric differs; tutorial has none → pillars []).

-- One-line, load-bearing: without this the per-scenario scan is a seq scan over ALL sessions
-- (cost ∝ platform-wide volume, not this scenario). Partial index excludes OPEN rows.
create index if not exists sessions_scenario_ended_idx
  on public.sessions (scenario_id, ended_at)
  where ended_at is not null;

create or replace function admin.scenario_analytics(p_scenario_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with sd as (
    select code, title from public.scenario_definition where code = p_scenario_id
  ),
  ended as (
    select ending_type, trigger, scores_json
    from public.sessions
    where ended_at is not null and scenario_id = p_scenario_id   -- OPEN rows excluded
  ),
  -- Per-session rubric mean over NUMERIC, IN-RANGE values only — SAME shape as metrics_overview
  -- so the drill-down's avg_score equals the dashboard table's per-scenario avg_score. The OUTER
  -- object-guard is REQUIRED: jsonb_each() RAISES on a top-level non-object (array/scalar/'null').
  session_score as (
    select case when jsonb_typeof(e.scores_json) = 'object' then
             (select avg(num)
                from (select case when jsonb_typeof(v.value) = 'number'
                                  then (v.value)::numeric end as num    -- CASE gates the cast
                      from jsonb_each(e.scores_json) v) t
               where num between 0 and 100)                             -- range-guard the safe numeric
           end as score
    from ended e
  ),
  -- Exploded (pillar key, value) pairs for the per-pillar distribution. jsonb_each is fed an
  -- object-guarded argument ('{}' when not an object) so a poisoned row yields zero rows, not a
  -- crash; `num` is NULL for non-numeric values and dropped by the range filter.
  pillar_vals as (
    select kv.key as pkey, kv.num
    from ended e
    cross join lateral (
      select key,
             case when jsonb_typeof(value) = 'number' then (value)::numeric end as num
      from jsonb_each(case when jsonb_typeof(e.scores_json) = 'object'
                           then e.scores_json else '{}'::jsonb end)
    ) kv
    where kv.num between 0 and 100
  ),
  pillar_agg as (
    select pkey,
           count(*)                                              as cnt,
           round(avg(num), 1)                                    as avg,
           -- Bands 0-20 / 21-40 / 41-60 / 61-80 / 81-100 (inclusive top) — explicit, no floor/20
           -- off-by-one. 100 lands in the last band; empty bands stay 0.
           count(*) filter (where num <= 20)                     as b0,
           count(*) filter (where num > 20 and num <= 40)        as b1,
           count(*) filter (where num > 40 and num <= 60)        as b2,
           count(*) filter (where num > 60 and num <= 80)        as b3,
           count(*) filter (where num > 80)                      as b4
    from pillar_vals
    group by pkey
  ),
  outcome as (
    select
      count(*)                                                      as attempts,
      count(*) filter (where trigger <> 'force_quit_level_2')       as completed,
      count(*) filter (where trigger =  'force_quit_level_2')       as bubar,
      count(*) filter (where trigger =  'manual')                   as t_manual,
      count(*) filter (where trigger =  'sinyal_level_1')           as t_sinyal,
      count(*) filter (where trigger =  'force_quit_level_2')       as t_fq,
      count(*) filter (where ending_type = 'good')                  as e_good,
      count(*) filter (where ending_type = 'neutral')               as e_neutral,
      count(*) filter (where ending_type = 'bad')                   as e_bad
    from ended
  )
  select jsonb_build_object(
    'scenario_id', (select code from sd),
    'title', (select title from sd),
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'attempts', (select attempts from outcome),
    'outcome', jsonb_build_object(
      'completed', (select completed from outcome),
      'bubar', (select bubar from outcome),
      -- fixed 3 keys zero-filled for a stable FE layout; typed as an open dict so a future
      -- trigger value cannot break the contract.
      'by_trigger', jsonb_build_object(
        'manual',             (select t_manual from outcome),
        'sinyal_level_1',     (select t_sinyal from outcome),
        'force_quit_level_2', (select t_fq from outcome)
      ),
      'ending_counts', jsonb_build_object(
        'good',    (select e_good from outcome),
        'neutral', (select e_neutral from outcome),
        'bad',     (select e_bad from outcome)
      )
    ),
    -- overall avg_score = mean of per-session rubric means (session-weighted), matching the
    -- dashboard; null when no scored session.
    'avg_score', (select round(avg(score), 1) from session_score),
    'pillars', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', pkey, 'count', cnt, 'avg', avg,
               'buckets', jsonb_build_array(b0, b1, b2, b3, b4)
             ) order by pkey)
      from pillar_agg), '[]'::jsonb),
    'dropoff', null    -- event-log / step-level drop-off ships in a follow-up ticket
  );
$$;

-- RLS-bypass invariant self-documenting (don't rely on "migration runs as postgres").
alter function admin.scenario_analytics(text) owner to postgres;

-- ── grant matrix (same discipline as metrics_overview) ─────────────────────────────────
-- `revoke ... from public` alone is NOT enough: Supabase default-privileges grant EXECUTE to
-- anon/authenticated — revoke from them explicitly, then grant ONLY to metrics_reader.
revoke all on function admin.scenario_analytics(text) from public, anon, authenticated;
grant usage on schema admin to metrics_reader;                        -- idempotent (also in SIM-15)
grant execute on function admin.scenario_analytics(text) to metrics_reader;
alter default privileges in schema admin revoke execute on functions from public, anon, authenticated;
