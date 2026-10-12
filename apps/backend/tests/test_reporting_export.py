"""Test `GET /admin/reports/sessions.csv` (SIM-19): auth gating, param parse/forward, CSV assembly,
and fail-soft 503.

Mirrors test_scenario_analytics.py: real verifier + fake JWKS with admin tokens; the DB is never
touched (200 cases monkeypatch `metrics_db.fetch_session_export`; the 503 case relies on the lifespan
leaving `metrics_pool=None` so the real fail-soft path runs). SQL behavior (filtering/ordering/avg)
is NOT tested here — route tests inject rows, so those live in pgTAP `087-admin-session-export.sql`.
CSV formatting is pure Python and is tested by calling `_build_sessions_csv`/`_csv_safe` directly.
"""

from __future__ import annotations

import asyncio
import csv
import io
from datetime import date

import asyncpg
import pytest

from api import metrics_db
from api.metrics_db import MetricsUnavailable
from api.server import _CSV_HEADER, _build_sessions_csv, _csv_safe

PATH = "/admin/reports/sessions.csv"


def _admin_token(token_factory) -> str:
    return token_factory(sub="admin-1", is_anonymous=False, is_admin=True)


def _admin_headers(token_factory) -> dict[str, str]:
    return {"Authorization": f"Bearer {_admin_token(token_factory)}"}


# A contract-shaped stub row set (deterministic JSON types, exactly what the jsonb fn decodes to).
SAMPLE_ROWS: list[dict] = [
    {
        "session_id": "11111111-1111-1111-1111-111111111111",
        "scenario_id": "kredit-macet",
        "scenario_title": "Kredit Macet",
        "started_at": "2026-03-01T10:00:00Z",
        "ended_at": "2026-03-01T10:02:05Z",
        "duration_seconds": 125,
        "trigger": "manual",
        "ending_type": "good",
        "avg_score": 85.0,
    },
    {
        "session_id": "22222222-2222-2222-2222-222222222222",
        "scenario_id": "tutorial-koperasi-konsumen",
        "scenario_title": "Tutorial — Koperasi Konsumen",
        "started_at": "2026-03-02T10:00:00Z",
        "ended_at": "2026-03-02T10:00:00Z",
        "duration_seconds": 0,
        "trigger": "manual",
        "ending_type": "neutral",
        "avg_score": None,
    },
]


def _patch_fetch(monkeypatch, rows):
    async def _fake(_pool, _p_from, _p_to):
        return rows

    monkeypatch.setattr(metrics_db, "fetch_session_export", _fake)


def _decode(body: bytes) -> list[list[str]]:
    # utf-8-sig strips the BOM; csv.reader parses RFC-4180 (handles quoted commas/newlines).
    return list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))


# Column index by header name — keeps assertions robust to column-order changes.
COL = {name: i for i, name in enumerate(_CSV_HEADER)}


# --------------------------------- happy path (route) -------------------------------


def test_admin_gets_csv_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_fetch(monkeypatch, SAMPLE_ROWS)
    resp = client.get(PATH, headers=_admin_headers(token_factory))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    cd = resp.headers["content-disposition"]
    assert cd.startswith('attachment; filename="koperasi-sessions-') and cd.endswith('.csv"')
    rows = _decode(resp.content)
    assert rows[0] == _CSV_HEADER
    assert len(rows) == 1 + len(SAMPLE_ROWS)
    assert rows[1][COL["session_id"]] == "11111111-1111-1111-1111-111111111111"
    assert rows[1][COL["duration_seconds"]] == "125"
    assert rows[1][COL["avg_score"]] == "85.0"
    assert rows[2][COL["avg_score"]] == ""  # null avg_score → empty cell


def test_empty_export_is_header_only(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_fetch(monkeypatch, [])
    resp = client.get(PATH, headers=_admin_headers(token_factory))
    assert resp.status_code == 200
    assert _decode(resp.content) == [_CSV_HEADER]


def test_date_params_parsed_and_forwarded(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    captured: dict[str, date | None] = {}

    async def _fake(_pool, p_from, p_to):
        captured["from"], captured["to"] = p_from, p_to
        return []

    monkeypatch.setattr(metrics_db, "fetch_session_export", _fake)
    resp = client.get(f"{PATH}?from=2026-10-01&to=2026-10-10", headers=_admin_headers(token_factory))
    assert resp.status_code == 200
    assert captured["from"] == date(2026, 10, 1)  # proves `from` alias binds + parse
    assert captured["to"] == date(2026, 10, 10)


# --------------------------------- auth gating (route) ------------------------------


def test_no_token_is_401(client, install_jwks):
    install_jwks()
    assert client.get(PATH).status_code == 401


def test_expired_token_is_401(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(exp_delta=-3600, is_admin=True, is_anonymous=False)
    assert client.get(PATH, headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_non_admin_is_403(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False)  # no is_admin claim
    resp = client.get(PATH, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "forbidden"}


def test_anonymous_admin_is_403(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(sub="g", is_admin=True, is_anonymous=True)
    assert client.get(PATH, headers={"Authorization": f"Bearer {token}"}).status_code == 403


def test_non_admin_never_touches_db(client, install_jwks, token_factory, monkeypatch):
    async def _boom(_pool, _p_from, _p_to):
        raise AssertionError("fetch_session_export reached without admin")

    monkeypatch.setattr(metrics_db, "fetch_session_export", _boom)
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False)
    assert client.get(PATH, headers={"Authorization": f"Bearer {token}"}).status_code == 403


# --------------------------------- param validation (route) -------------------------


def test_malformed_from_is_422_and_db_never_touched(client, install_jwks, token_factory, monkeypatch):
    async def _boom(_pool, _p_from, _p_to):
        raise AssertionError("fetch_session_export reached for a malformed date")

    monkeypatch.setattr(metrics_db, "fetch_session_export", _boom)
    install_jwks()
    resp = client.get(f"{PATH}?from=2026-13-40", headers=_admin_headers(token_factory))
    assert resp.status_code == 422
    assert resp.json() == {"detail": "from_invalid"}


def test_datetime_granularity_is_422(client, install_jwks, token_factory):
    install_jwks()
    resp = client.get(f"{PATH}?from=2026-10-12T08:00:00Z", headers=_admin_headers(token_factory))
    assert resp.status_code == 422
    assert resp.json() == {"detail": "from_invalid"}


def test_to_invalid_is_422(client, install_jwks, token_factory):
    install_jwks()
    resp = client.get(f"{PATH}?to=2026/10/12", headers=_admin_headers(token_factory))
    assert resp.status_code == 422
    assert resp.json() == {"detail": "to_invalid"}


@pytest.mark.parametrize("raw", ["20261012", "2026-W40-1"])  # looser ISO forms date.fromisoformat accepts
def test_non_strict_iso_date_forms_rejected(raw, client, install_jwks, token_factory):
    # Strict YYYY-MM-DD only (CONTRACT); basic/ISO-week forms → 422, not a silently-accepted date.
    install_jwks()
    resp = client.get(f"{PATH}?from={raw}", headers=_admin_headers(token_factory))
    assert resp.status_code == 422
    assert resp.json() == {"detail": "from_invalid"}


def test_auth_precedes_validation(client, install_jwks):
    # No token + a malformed date → 401 (gate first), NOT 422. (FastAPI resolves the auth dependency
    # and propagates its HTTPException before validating this operation's own query params.)
    install_jwks()
    assert client.get(f"{PATH}?from=not-a-date").status_code == 401


# --------------------------------- fail-soft 503 (route) ----------------------------


def test_db_down_is_503_with_real_auth(client, install_jwks, token_factory):
    # No monkeypatch: lifespan left metrics_pool=None (METRICS_DB_URL unset) → real fail-soft → 503.
    install_jwks()
    resp = client.get(PATH, headers=_admin_headers(token_factory))
    assert resp.status_code == 503
    assert resp.json() == {"detail": "metrics_unavailable"}


def test_fail_soft_isolation_health_unaffected(client, install_jwks, token_factory):
    # Pool down degrades the export to 503 but must NOT affect /health.
    install_jwks()
    assert client.get(PATH, headers=_admin_headers(token_factory)).status_code == 503
    assert client.get("/health").status_code == 200


# --------------------------------- CORS ---------------------------------------------


def test_export_preflight_allows_get(client):
    resp = client.options(
        PATH,
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5174"


# ------------------------- CSV builder (pure Python) --------------------------------


def test_csv_builder_header_and_crlf():
    body = _build_sessions_csv(SAMPLE_ROWS[:1])
    assert b"\r\n" in body  # RFC-4180 line terminator
    rows = _decode(body)
    assert rows[0] == _CSV_HEADER
    assert rows[1][COL["duration_seconds"]] == "125" and rows[1][COL["avg_score"]] == "85.0"


def test_csv_builder_avg_rendering():
    rows = _decode(_build_sessions_csv([
        {**SAMPLE_ROWS[0], "avg_score": 100.0},
        {**SAMPLE_ROWS[0], "avg_score": 46.4},
        {**SAMPLE_ROWS[0], "avg_score": None},
    ]))
    assert [r[COL["avg_score"]] for r in rows[1:]] == ["100.0", "46.4", ""]


def test_csv_builder_rfc4180_quoting():
    # Comma + embedded quote + newline must survive a round-trip (quoted, inner quotes doubled).
    tricky = 'A, "B"\nC'
    rows = _decode(_build_sessions_csv([{**SAMPLE_ROWS[0], "scenario_title": tricky}]))
    assert rows[1][COL["scenario_title"]] == tricky


def test_csv_builder_sanitizes_both_free_text_cells():
    rows = _decode(_build_sessions_csv([{
        **SAMPLE_ROWS[0],
        "scenario_id": "=evil()",
        "scenario_title": "@cmd",
    }]))
    assert rows[1][COL["scenario_id"]] == "'=evil()"
    assert rows[1][COL["scenario_title"]] == "'@cmd"


def test_csv_builder_utf8_bom_and_non_ascii():
    body = _build_sessions_csv([{**SAMPLE_ROWS[0], "scenario_title": "Keanggotaan Fiktif — ríng"}])
    assert body.startswith(b"\xef\xbb\xbf")  # Excel BOM
    assert "ríng" in body.decode("utf-8-sig")


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, ""),
        ("", ""),
        ("=1+1", "'=1+1"),
        ("+x", "'+x"),
        ("-5", "'-5"),
        ("@SUM", "'@SUM"),
        ("\tx", "'\tx"),
        ("\rx", "'\rx"),
        ("normal", "normal"),
        ("a=b", "a=b"),  # only a LEADING trigger char matters
    ],
)
def test_csv_safe(value, expected):
    assert _csv_safe(value) == expected


# ------------------------- metrics_db unit (fail-soft breadth) ----------------------


class _FakeConn:
    def __init__(self, exc=None, value=None):
        self._exc = exc
        self._value = value

    async def fetchval(self, *_a, **_k):
        if self._exc is not None:
            raise self._exc
        return self._value


class _FakeAcquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *_a):
        return False


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self, *, timeout=None):
        return _FakeAcquire(self._conn)


def test_fetch_session_export_none_pool_raises_unavailable():
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_session_export(None, None, None))


@pytest.mark.parametrize(
    "exc",
    [asyncpg.InterfaceError("connection was closed"), asyncpg.PostgresError("boom")],
)
def test_fetch_session_export_db_fault_maps_to_unavailable(exc):
    # Broad-except breadth (client InterfaceError + server PostgresError) in one case; the shared
    # _call_definer owns this mapping, so this wrapper only needs to confirm it routes into it.
    pool = _FakePool(_FakeConn(exc=exc))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_session_export(pool, None, None))


def test_fetch_session_export_returns_rows_on_success():
    pool = _FakePool(_FakeConn(value=SAMPLE_ROWS))
    assert asyncio.run(metrics_db.fetch_session_export(pool, None, None)) == SAMPLE_ROWS


def test_fetch_session_export_empty_list_is_valid_not_unavailable():
    # coalesce(jsonb_agg,…,'[]') → an empty export is [] (never SQL NULL): a valid 200, NOT a 503.
    pool = _FakePool(_FakeConn(value=[]))
    assert asyncio.run(metrics_db.fetch_session_export(pool, None, None)) == []
