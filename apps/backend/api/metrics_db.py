"""Admin DB access (SIM-15/16/17).

The ONLY database path in this otherwise DB-free backend. A fail-soft asyncpg pool
connects as the `metrics_reader` role — an admin DB role that performs **reads** (metrics
/ scenario analytics / leaderboard overview via STABLE SECURITY DEFINER fns) AND, since
SIM-17, **admin-gated writes** (leaderboard capture/delete via VOLATILE SECURITY DEFINER
fns). The role still holds NO direct table privileges — every statement goes through a
definer fn; the blast radius of `METRICS_DB_URL` widened from read-only to admin writes.
"Fail-soft" is the backbone: a DB that is down, misconfigured, OR slow must degrade the
`/admin/*` endpoints to 503 and must NEVER take down `/token` or `/health` — so pool
creation is bounded and never raises out of this module, and the DSN/host are never logged.

The connection string lives in `METRICS_DB_URL` (backend env only; never committed or
logged). Through the Supabase pooler the username MUST be `metrics_reader.<project-ref>`.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

import asyncpg

log = logging.getLogger("koperasi.metrics")


class MetricsUnavailable(Exception):
    """The metrics DB is unavailable (down / misconfigured / slow / dropped connection).

    Raised by this module so the data layer stays HTTP-agnostic; the route maps it to 503.
    """


def _ssl_mode() -> str:
    """SSL mode for the pool, driven by env (NOT hardcoded).

    Hosted pooler → `verify-full` (encrypt AND authenticate the server; plain `require`
    is MITM-open on the public pooler path, which would leak the password). Local
    Supabase (127.0.0.1) serves no TLS → set `METRICS_DB_SSL=disable`. asyncpg accepts the
    libpq sslmode strings directly. `… or "verify-full"` treats an empty value as unset
    (secure default) instead of passing "" → create_pool error → 503.
    """
    return os.environ.get("METRICS_DB_SSL") or "verify-full"


async def _init_conn(conn: asyncpg.Connection) -> None:
    """Decode jsonb as dict per physical connection (asyncpg returns it as str otherwise)."""
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text"
    )


async def create_pool() -> asyncpg.Pool | None:
    """Create the metrics pool, or return None (fail-soft) if it can't be built.

    Reads METRICS_DB_URL HERE (not at import) — this runs in the FastAPI lifespan, after
    load_dotenv(); a module-scope read would execute before server.py's load_dotenv and be
    empty. `min_size=0` keeps nothing pinned on the scarce session pooler while idle, so
    startup NEVER connects (a dead host can't hang lifespan / delay /token+/health). The
    first request pays the connect, bounded by `timeout` here and by acquire() in fetch_metrics.
    The try/except still catches synchronous DSN/config errors at build time.
    """
    dsn = os.environ.get("METRICS_DB_URL", "")
    if not dsn:
        log.warning("METRICS_DB_URL belum di-set — GET /admin/metrics akan 503.")
        return None
    try:
        return await asyncpg.create_pool(
            dsn=dsn,
            ssl=_ssl_mode(),
            min_size=0,
            max_size=5,  # keep ≤ role CONNECTION LIMIT / instance count (session pooler pins a backend)
            init=_init_conn,
            timeout=4.0,  # per-connection connect bound (applies at first acquire; ≤ acquire budget)
            command_timeout=4.0,  # per-query bound; acquire(5) + command(4) = 9s < the FE 10s probe
        )
    except Exception as exc:  # noqa: BLE001 — fail-soft core: ANY failure → no pool → 503 (never raise)
        log.error(
            "Gagal membuat pool metrics DB (%s) — GET /admin/metrics akan 503.",
            type(exc).__name__,  # type name only; never the exception/DSN/host
        )
        return None


async def fetch_metrics(pool: asyncpg.Pool | None) -> dict[str, Any]:
    """Call admin.metrics_overview() and return its jsonb as a dict.

    Raises MetricsUnavailable on any fault (no pool / dropped connection / timeout / query
    error / unexpected NULL). The except is deliberately BROAD: asyncpg splits PostgresError
    (server) and InterfaceError (client — dropped conn/closed pool) into unrelated roots, so a
    narrow catch would let a dropped connection escape as a 500 and break the fail-soft guarantee.
    """
    if pool is None:
        raise MetricsUnavailable
    try:
        async with pool.acquire(timeout=5.0) as conn:  # bound acquire (≥ connect) → 503, never a hang
            row = await conn.fetchval("select admin.metrics_overview()")
    except Exception as exc:  # BROAD: PostgresError AND InterfaceError (dropped conn) → 503, never 500
        log.error("Query metrics gagal (%s)", type(exc).__name__)  # never log DSN/claims
        raise MetricsUnavailable from exc
    if row is None:  # the fn always builds an object; a NULL would 500 the typed route → keep fail-soft
        raise MetricsUnavailable
    return row


async def fetch_scenario_analytics(pool: asyncpg.Pool | None, scenario_id: str) -> dict[str, Any]:
    """Call admin.scenario_analytics($1) and return its jsonb as a dict (SIM-16).

    Same fail-soft contract as fetch_metrics: no pool / dropped connection / timeout / query error
    / unexpected NULL → MetricsUnavailable (→ 503, never 500). The except is deliberately BROAD
    (PostgresError server-side AND InterfaceError client-side) for the same reason as fetch_metrics.
    scenario_id is passed as a bound parameter ($1) — never string-interpolated.
    """
    if pool is None:
        raise MetricsUnavailable
    try:
        async with pool.acquire(timeout=5.0) as conn:  # bound acquire (≥ connect) → 503, never a hang
            row = await conn.fetchval("select admin.scenario_analytics($1)", scenario_id)
    except Exception as exc:  # BROAD: PostgresError AND InterfaceError (dropped conn) → 503, never 500
        # scenario_id is a bounded non-PII code (VALID_SCENARIOS) → safe to log for triage; still
        # NEVER log the DSN/claims/exception message.
        log.error("Query scenario_analytics gagal untuk %s (%s)", scenario_id, type(exc).__name__)
        raise MetricsUnavailable from exc
    if row is None:
        raise MetricsUnavailable
    return row


_OMIT = object()  # sentinel: "no non-PII arg to include in the fault log"


async def _call_definer(
    pool: asyncpg.Pool | None,
    sql: str,
    *args: Any,
    log_name: str,
    log_arg: Any = _OMIT,
) -> dict[str, Any]:
    """Shared body for the SIM-17 definer-fn calls (overview/capture/delete).

    Identical fail-soft contract to fetch_scenario_analytics: None pool / dropped connection /
    timeout / query error / unexpected NULL → MetricsUnavailable (→ 503, never 500); the except is
    deliberately BROAD (PostgresError server-side AND InterfaceError client-side). `args` are bound
    positionally ($1…) — never string-interpolated. `log_arg` (a NON-PII id, or _OMIT) is the only
    value included in the fault log — NEVER pass `label` or any PII; the DSN/claims/exception
    message are never logged.
    """
    if pool is None:
        raise MetricsUnavailable
    try:
        async with pool.acquire(timeout=5.0) as conn:  # bound acquire (≥ connect) → 503, never a hang
            row = await conn.fetchval(sql, *args)
    except Exception as exc:  # BROAD: PostgresError AND InterfaceError (dropped conn) → 503, never 500
        if log_arg is _OMIT:
            log.error("Query %s gagal (%s)", log_name, type(exc).__name__)
        else:
            log.error("Query %s gagal untuk %s (%s)", log_name, log_arg, type(exc).__name__)
        raise MetricsUnavailable from exc
    if row is None:
        raise MetricsUnavailable
    return row


async def fetch_leaderboard_overview(
    pool: asyncpg.Pool | None, season_id: uuid.UUID | None
) -> dict[str, Any]:
    """Call admin.leaderboard_overview($1) → jsonb dict (SIM-17). A null season_id resolves to the
    latest season. season_id (uuid|None) is bound natively ($1, no `::uuid` cast) and is a non-PII
    id, so it's included in the fault log for triage."""
    return await _call_definer(
        pool, "select admin.leaderboard_overview($1)", season_id,
        log_name="leaderboard_overview", log_arg=season_id,
    )


async def capture_leaderboard_snapshot(
    pool: asyncpg.Pool | None, label: str | None
) -> dict[str, Any]:
    """Call admin.capture_leaderboard_snapshot($1) → jsonb dict (SIM-17). An admin-gated WRITE via a
    VOLATILE definer fn: advisory-lock contention surfaces as a bounded wait → fail-soft 503 on
    timeout (the lock is xact-scoped and auto-releases, so a retry succeeds), NOT a DB outage.
    `label` is bound as $1 and NEVER logged (no `log_arg`); attribution is logged at the route."""
    return await _call_definer(
        pool, "select admin.capture_leaderboard_snapshot($1)", label,
        log_name="capture_leaderboard_snapshot",
    )


async def delete_leaderboard_season(
    pool: asyncpg.Pool | None, season_id: uuid.UUID
) -> dict[str, Any]:
    """Call admin.delete_leaderboard_season($1) → jsonb dict (SIM-17). An admin-gated WRITE via a
    VOLATILE definer fn that returns `{deleted, season_number}` and does NOT raise on an absent
    season (a raise would be masked as a 503); the route maps `deleted == false` → 404."""
    return await _call_definer(
        pool, "select admin.delete_leaderboard_season($1)", season_id,
        log_name="delete_leaderboard_season", log_arg=season_id,
    )
