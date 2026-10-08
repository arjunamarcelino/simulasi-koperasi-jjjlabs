"""Admin metrics DB access (SIM-15).

The ONLY database path in this otherwise DB-free backend. A fail-soft asyncpg pool
connects as the least-privilege `metrics_reader` role and calls the SECURITY DEFINER
`admin.metrics_overview()`. "Fail-soft" is the backbone: a metrics DB that is down,
misconfigured, OR slow must degrade `GET /admin/metrics` to 503 and must NEVER take
down `/token` or `/health` — so pool creation is bounded and never raises out of this
module, and the DSN/host are never logged.

The connection string lives in `METRICS_DB_URL` (backend env only; never committed or
logged). Through the Supabase pooler the username MUST be `metrics_reader.<project-ref>`.
"""

from __future__ import annotations

import json
import logging
import os
import ssl

import asyncpg

log = logging.getLogger("koperasi.metrics")


class MetricsUnavailable(Exception):
    """The metrics DB is unavailable (down / misconfigured / slow / dropped connection).

    Raised by this module so the data layer stays HTTP-agnostic; the route maps it to 503.
    """


def _ssl_arg() -> object:
    """SSL mode for the pool, driven by env (NOT hardcoded).

    Hosted pooler → `verify-full` (encrypt AND authenticate the server; plain `require`
    is MITM-open on the public pooler path, which would leak the password). Local
    Supabase (127.0.0.1) serves no TLS → `disable`. `METRICS_DB_SSL` defaults to
    `verify-full`; `METRICS_DB_CA_CERT` optionally pins Supabase's CA.
    """
    mode = os.environ.get("METRICS_DB_SSL", "verify-full")
    ca = os.environ.get("METRICS_DB_CA_CERT")
    if ca and mode in ("verify-ca", "verify-full"):
        ctx = ssl.create_default_context(cafile=ca)
        if mode == "verify-ca":
            ctx.check_hostname = False
        return ctx
    return mode  # asyncpg accepts the libpq sslmode strings directly


async def _init_conn(conn: asyncpg.Connection) -> None:
    """Decode jsonb as dict per physical connection (asyncpg returns it as str otherwise)."""
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text"
    )


async def create_pool() -> asyncpg.Pool | None:
    """Create the metrics pool, or return None (fail-soft) if it can't be built.

    Reads METRICS_DB_URL HERE (not at import) — this runs in the FastAPI lifespan, after
    load_dotenv(); a module-scope read would execute before server.py's load_dotenv and be
    empty. `timeout` bounds connection establishment so a blackholed host fails fast instead
    of hanging startup (which would delay /token and /health). `min_size=0` keeps nothing
    pinned on the scarce pooler while idle.
    """
    dsn = os.environ.get("METRICS_DB_URL", "")
    if not dsn:
        log.warning("METRICS_DB_URL belum di-set — GET /admin/metrics akan 503.")
        return None
    try:
        return await asyncpg.create_pool(
            dsn=dsn,
            ssl=_ssl_arg(),
            min_size=0,
            max_size=5,  # keep < role CONNECTION LIMIT / instance count (session pooler pins a backend)
            init=_init_conn,
            timeout=5.0,  # bound connect: a dead host must NOT hang lifespan startup
            command_timeout=8.0,  # per-query bound, under the FE 10s probe timeout
        )
    except Exception as exc:  # noqa: BLE001 — fail-soft core: ANY failure → no pool → 503 (never raise)
        log.error(
            "Gagal membuat pool metrics DB (%s) — GET /admin/metrics akan 503.",
            type(exc).__name__,  # type name only; never the exception/DSN/host
        )
        return None


async def fetch_metrics(pool: asyncpg.Pool | None) -> dict[str, object]:
    """Call admin.metrics_overview() and return its jsonb as a dict.

    Raises MetricsUnavailable on any fault (no pool / dropped connection / timeout / query
    error). The except is deliberately BROAD: asyncpg splits PostgresError (server) and
    InterfaceError (client — dropped conn/closed pool) into unrelated roots, so a narrow
    catch would let a dropped connection escape as a 500 and break the fail-soft guarantee.
    """
    if pool is None:
        raise MetricsUnavailable
    try:
        async with pool.acquire(timeout=3.0) as conn:  # bound acquire → 503, never a hang
            return await conn.fetchval("select admin.metrics_overview()")
    except Exception as exc:  # BROAD: PostgresError AND InterfaceError (dropped conn) → 503, never 500
        log.error("Query metrics gagal (%s)", type(exc).__name__)  # never log DSN/claims
        raise MetricsUnavailable from exc
