"""Test `GET /admin/metrics` (SIM-15): auth gating, fail-soft 503, body pass-through.

Auth uses the REAL verifier + fake JWKS (install_jwks) with admin tokens from
token_factory. The DB is never touched: the 200/empty cases monkeypatch
`metrics_db.fetch_metrics`; the 503 case relies on the lifespan leaving
`metrics_pool=None` (METRICS_DB_URL unset in tests) so the real fail-soft path runs.
"""

from __future__ import annotations

import asyncio

import asyncpg
import pytest
from pydantic import ValidationError

from api import metrics_db
from api.metrics_db import MetricsUnavailable


def _admin_token(token_factory) -> str:
    return token_factory(sub="admin-1", is_anonymous=False, is_admin=True)


SAMPLE = {
    "generated_at": "2026-10-09T04:00:00Z",
    "users": {"active_30d": 2, "total_registered": 3, "new_7d": 3},
    "sessions": {
        "total": 10,
        "completion_rate": 0.9,
        "ending_split": {"good": 0.7, "neutral": 0.2, "bad": 0.1},
        "avg_score": 55.0,
    },
    "per_scenario": [
        {
            "scenario_id": "kredit-macet",
            "title": "Kredit Macet",
            "sessions": 10,
            "completion_rate": 0.9,
            "ending_split": {"good": 0.7, "neutral": 0.2, "bad": 0.1},
            "avg_score": 55.0,
        },
        {
            "scenario_id": "keanggotaan-fiktif",
            "title": "Keanggotaan Fiktif",
            "sessions": 0,
            "completion_rate": None,
            "ending_split": None,
            "avg_score": None,
        },
    ],
}

EMPTY = {
    "generated_at": "2026-10-09T04:00:00Z",
    "users": {"active_30d": 0, "total_registered": 0, "new_7d": 0},
    "sessions": {"total": 0, "completion_rate": None, "ending_split": None, "avg_score": None},
    "per_scenario": [],
}


def _patch_fetch(monkeypatch, payload):
    async def _fake(_pool):
        return payload

    monkeypatch.setattr(metrics_db, "fetch_metrics", _fake)


# --------------------------------- happy path ---------------------------------------


def test_admin_gets_metrics_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_fetch(monkeypatch, SAMPLE)
    resp = client.get("/admin/metrics", headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 200
    body = resp.json()
    # Numbers survive as int/float (no Decimal), nested shape intact, null preserved.
    assert body["users"]["active_30d"] == 2
    assert body["sessions"]["completion_rate"] == 0.9
    assert body["sessions"]["avg_score"] == 55.0
    assert body["per_scenario"][1]["completion_rate"] is None


def test_empty_db_is_200_not_error(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_fetch(monkeypatch, EMPTY)
    resp = client.get("/admin/metrics", headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 200
    assert resp.json()["sessions"]["total"] == 0
    assert resp.json()["sessions"]["avg_score"] is None


# --------------------------------- auth gating --------------------------------------


def test_no_token_is_401(client, install_jwks):
    install_jwks()
    assert client.get("/admin/metrics").status_code == 401


def test_non_admin_is_403(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False)  # no is_admin claim
    resp = client.get("/admin/metrics", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "forbidden"}


def test_anonymous_admin_is_403(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(sub="g", is_admin=True, is_anonymous=True)
    assert client.get("/admin/metrics", headers={"Authorization": f"Bearer {token}"}).status_code == 403


def test_expired_token_is_401(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(exp_delta=-3600, is_admin=True, is_anonymous=False)
    assert client.get("/admin/metrics", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_non_admin_never_touches_the_db(client, install_jwks, token_factory, monkeypatch):
    # Structural gating: a forbidden caller must not reach get_metrics → fetch_metrics.
    async def _boom(_pool):
        raise AssertionError("fetch_metrics reached without admin")

    monkeypatch.setattr(metrics_db, "fetch_metrics", _boom)
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False)
    assert client.get("/admin/metrics", headers={"Authorization": f"Bearer {token}"}).status_code == 403


# --------------------------------- fail-soft 503 ------------------------------------


def test_db_down_is_503_with_real_auth(client, install_jwks, token_factory):
    # No monkeypatch: lifespan left metrics_pool=None (METRICS_DB_URL unset) → the REAL
    # fail-soft path runs → 503 (not 500). Admin auth is real.
    install_jwks()
    resp = client.get("/admin/metrics", headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503
    assert resp.json() == {"detail": "metrics_unavailable"}


def test_metrics_db_down_does_not_break_health_or_token(client, install_jwks, token_factory):
    # The whole point of fail-soft: a dead metrics DB must NOT take down the game endpoints.
    install_jwks()
    assert client.get("/health").status_code == 200
    # /admin/metrics is 503 in the SAME app (pool None) — isolation proven.
    assert client.get(
        "/admin/metrics", headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    ).status_code == 503


# --------------------------------- CORS ---------------------------------------------


def test_admin_metrics_preflight_allows_get(client):
    resp = client.options(
        "/admin/metrics",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5174"


# ------------------------- metrics_db unit (fail-soft breadth) ----------------------


def test_fetch_metrics_none_pool_raises_unavailable():
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_metrics(None))


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

    def acquire(self, *, timeout=None):  # mirrors asyncpg.Pool.acquire(timeout=...)
        return _FakeAcquire(self._conn)


def test_fetch_metrics_interface_error_maps_to_unavailable():
    # asyncpg.InterfaceError (client-side, e.g. dropped connection) is a SEPARATE root from
    # PostgresError — the broad except must catch it → MetricsUnavailable (→ 503, not 500).
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("connection was closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_metrics(pool))


def test_fetch_metrics_postgres_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_metrics(pool))


def test_fetch_metrics_returns_dict_on_success():
    pool = _FakePool(_FakeConn(value={"generated_at": "x"}))
    assert asyncio.run(metrics_db.fetch_metrics(pool)) == {"generated_at": "x"}


# ------------------------- response model (frozen contract) -------------------------


def test_response_model_forbids_extra_keys():
    from api.server import AdminMetricsResponse

    with pytest.raises(ValidationError):
        AdminMetricsResponse(**{**SAMPLE, "surprise": 1})
