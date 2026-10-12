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
from datetime import date, datetime
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
) -> Any:
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


# ── SIM-18 quiz content (admin-gated CRUD) ───────────────────────────────────────────────
async def list_quiz(pool: asyncpg.Pool | None) -> dict[str, Any]:
    """Call admin.list_quiz() → {ok, rows:[…]} (SIM-18). The admin read that INCLUDES the
    hidden correct_index/explanation the game-facing quiz_catalog omits. Same fail-soft
    contract as the other definer calls (no pool / dropped conn / timeout / NULL → 503)."""
    return await _call_definer(pool, "select admin.list_quiz()", log_name="list_quiz")


async def upsert_quiz_question(
    pool: asyncpg.Pool | None,
    *,
    code: str,
    prompt: str,
    options: list[Any],
    correct_index: int,
    explanation: str | None,
    sort_order: int,
    prev_updated_at: datetime | None,
) -> dict[str, Any]:
    """Call admin.upsert_quiz_question(...) → {ok, reason?/row?} (SIM-18).

    CREATE when prev_updated_at is None, else a compare-and-swap EDIT (the fn returns
    reason='stale_write' on a mismatch). Keyword-only args are assembled into the positional
    $1..$7 tuple at THIS single site so the mapping is auditable (6+ same-ish params are a
    transposition foot-gun if bound ad hoc). `options` (a Python list) binds as jsonb via the
    connection's jsonb codec. Only `code` (non-PII) is logged — never prompt/options/explanation."""
    return await _call_definer(
        pool,
        "select admin.upsert_quiz_question($1, $2, $3, $4, $5, $6, $7)",
        code, prompt, options, correct_index, explanation, sort_order, prev_updated_at,
        log_name="upsert_quiz_question", log_arg=code,
    )


async def delete_quiz_question(pool: asyncpg.Pool | None, *, code: str) -> dict[str, Any]:
    """Call admin.delete_quiz_question($1) → {ok, deleted, reason?} (SIM-18). Returns a
    structured result (never raises), so a FK-blocked delete (answered question) maps to a
    clean 409 at the route, not a misleading 503."""
    return await _call_definer(
        pool, "select admin.delete_quiz_question($1)", code,
        log_name="delete_quiz_question", log_arg=code,
    )


# ── SIM-18 mading content (admin-gated CRUD) ─────────────────────────────────────────────
async def list_mading(pool: asyncpg.Pool | None) -> dict[str, Any]:
    """Call admin.list_mading() → {ok, groups:{info,data,knowledge,identitas}} (SIM-18)."""
    return await _call_definer(pool, "select admin.list_mading()", log_name="list_mading")


async def upsert_mading_block(
    pool: asyncpg.Pool | None,
    *,
    block_id: uuid.UUID | None,
    board: str | None,
    block_key: str | None,
    payload: dict[str, Any],
    sort_order: int,
    prev_updated_at: datetime | None,
) -> dict[str, Any]:
    """Call admin.upsert_mading_block(...) → {ok, reason?/row?} (SIM-18). CREATE when block_id is
    None (board+block_key required), else a compare-and-swap EDIT. `payload` (a Python dict) binds
    as jsonb via the connection codec. Only the non-PII id/block_key is logged — never the payload."""
    return await _call_definer(
        pool,
        "select admin.upsert_mading_block($1, $2, $3, $4, $5, $6)",
        block_id, board, block_key, payload, sort_order, prev_updated_at,
        log_name="upsert_mading_block",
        log_arg=(block_id if block_id is not None else block_key),
    )


async def delete_mading_block(pool: asyncpg.Pool | None, *, block_id: uuid.UUID) -> dict[str, Any]:
    """Call admin.delete_mading_block($1) → {ok, deleted, reason?} (SIM-18)."""
    return await _call_definer(
        pool, "select admin.delete_mading_block($1)", block_id,
        log_name="delete_mading_block", log_arg=block_id,
    )


# ── SIM-19 reporting / CSV export (admin-gated read) ─────────────────────────────────────
async def fetch_session_export(
    pool: asyncpg.Pool | None, p_from: date | None, p_to: date | None
) -> list[dict[str, Any]]:
    """Call admin.session_results_export($1, $2) → list of per-session row dicts (SIM-19).

    Reuses the shared fail-soft contract (_call_definer): no pool / dropped connection / timeout /
    query error → MetricsUnavailable (→ 503, never 500). The SQL fn returns coalesce(jsonb_agg(...),
    '[]'), so the result is NEVER SQL NULL — the `row is None → MetricsUnavailable` guard never
    misfires on an EMPTY export, which is a valid [] (a 200 header-only CSV). The decoded jsonb array
    IS a list[dict] via the connection's jsonb codec. p_from/p_to are bound positionally ($1/$2) as
    `date` (or NULL) — never string-interpolated; both non-PII, so included in the fault log for triage.
    Escape hatch for when a large export outgrows the pool's 4s command_timeout: a per-call
    conn.fetchval(..., timeout=<n>) override (would require parameterizing _call_definer)."""
    return await _call_definer(
        pool, "select admin.session_results_export($1, $2)", p_from, p_to,
        log_name="session_results_export",
    )
