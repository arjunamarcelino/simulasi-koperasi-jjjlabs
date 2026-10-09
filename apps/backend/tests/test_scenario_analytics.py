"""Test `GET /admin/scenarios/{id}/analytics` (SIM-16): auth gating, 404 vs 503, body shape.

Mirrors test_admin_metrics.py: real verifier + fake JWKS with admin tokens; the DB is never
touched (200 cases monkeypatch `metrics_db.fetch_scenario_analytics`; the 503 case relies on the
lifespan leaving `metrics_pool=None` so the real fail-soft path runs). The 404 case asserts the
DB is never reached (gate+validation precede the DB call).
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


PATH = "/admin/scenarios/kredit-macet/analytics"

SAMPLE = {
    "scenario_id": "kredit-macet",
    "title": "Kredit Macet",
    "generated_at": "2026-10-09T04:00:00Z",
    "attempts": 9,
    "outcome": {
        "completed": 8,
        "bubar": 1,
        "by_trigger": {"manual": 7, "sinyal_level_1": 1, "force_quit_level_2": 1},
        "ending_counts": {"good": 6, "neutral": 2, "bad": 1},
    },
    "avg_score": 46.4,
    "pillars": [
        {"key": "a", "count": 4, "avg": 20.3, "buckets": [2, 2, 0, 0, 0]},
        {"key": "b", "count": 5, "avg": 68.4, "buckets": [0, 0, 2, 2, 1]},
    ],
    "dropoff": None,
}

# Tutorial-shaped: no rubric (pillars []), avg_score null, dropoff null — must still validate.
TUTORIAL = {
    "scenario_id": "tutorial-koperasi-konsumen",
    "title": "Tutorial — Koperasi Konsumen",
    "generated_at": "2026-10-09T04:00:00Z",
    "attempts": 2,
    "outcome": {
        "completed": 2,
        "bubar": 0,
        "by_trigger": {"manual": 2, "sinyal_level_1": 0, "force_quit_level_2": 0},
        "ending_counts": {"good": 2, "neutral": 0, "bad": 0},
    },
    "avg_score": None,
    "pillars": [],
    "dropoff": None,
}


def _patch_fetch(monkeypatch, payload):
    async def _fake(_pool, _scenario_id):
        return payload

    monkeypatch.setattr(metrics_db, "fetch_scenario_analytics", _fake)


# --------------------------------- happy path ---------------------------------------


def test_admin_gets_analytics_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_fetch(monkeypatch, SAMPLE)
    resp = client.get(PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["attempts"] == 9
    assert body["outcome"]["completed"] == 8
    assert body["outcome"]["by_trigger"]["force_quit_level_2"] == 1
    assert body["avg_score"] == 46.4
    assert body["pillars"][1]["buckets"] == [0, 0, 2, 2, 1]
    assert body["dropoff"] is None


def test_tutorial_shape_is_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_fetch(monkeypatch, TUTORIAL)
    resp = client.get(
        "/admin/scenarios/tutorial-koperasi-konsumen/analytics",
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["pillars"] == []
    assert body["avg_score"] is None


# --------------------------------- auth gating --------------------------------------


def test_no_token_is_401(client, install_jwks):
    install_jwks()
    assert client.get(PATH).status_code == 401


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


def test_expired_token_is_401(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(exp_delta=-3600, is_admin=True, is_anonymous=False)
    assert client.get(PATH, headers={"Authorization": f"Bearer {token}"}).status_code == 401


# --------------------------------- 404 unknown scenario -----------------------------


def test_unknown_scenario_is_404_and_db_never_touched(client, install_jwks, token_factory, monkeypatch):
    # Validation precedes the DB call: an unknown scenario_id must 404 WITHOUT reaching fetch.
    async def _boom(_pool, _scenario_id):
        raise AssertionError("fetch_scenario_analytics reached for an unknown scenario")

    monkeypatch.setattr(metrics_db, "fetch_scenario_analytics", _boom)
    install_jwks()
    resp = client.get(
        "/admin/scenarios/does-not-exist/analytics",
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 404


def test_non_admin_unknown_scenario_is_403_not_404(client, install_jwks, token_factory):
    # Auth gate precedes scenario validation: a non-admin hitting an unknown scenario still 403s.
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False)
    resp = client.get(
        "/admin/scenarios/does-not-exist/analytics",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


# --------------------------------- fail-soft 503 ------------------------------------


def test_db_down_is_503_with_real_auth(client, install_jwks, token_factory):
    # No monkeypatch: lifespan left metrics_pool=None (METRICS_DB_URL unset) → real fail-soft → 503.
    # Scenario is VALID so it passes the 404 gate and reaches the (unavailable) DB.
    install_jwks()
    resp = client.get(PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503
    assert resp.json() == {"detail": "metrics_unavailable"}


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


def test_fetch_scenario_analytics_none_pool_raises_unavailable():
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_scenario_analytics(None, "kredit-macet"))


def test_fetch_scenario_analytics_interface_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("connection was closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_scenario_analytics(pool, "kredit-macet"))


def test_fetch_scenario_analytics_postgres_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_scenario_analytics(pool, "kredit-macet"))


def test_fetch_scenario_analytics_returns_dict_on_success():
    pool = _FakePool(_FakeConn(value={"scenario_id": "kredit-macet"}))
    assert asyncio.run(metrics_db.fetch_scenario_analytics(pool, "kredit-macet")) == {
        "scenario_id": "kredit-macet"
    }


def test_fetch_scenario_analytics_null_row_maps_to_unavailable():
    pool = _FakePool(_FakeConn(value=None))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_scenario_analytics(pool, "kredit-macet"))


# ------------------------- response model (frozen contract) -------------------------


def test_response_model_forbids_extra_keys():
    from api.server import ScenarioAnalyticsResponse

    with pytest.raises(ValidationError):
        ScenarioAnalyticsResponse(**{**SAMPLE, "surprise": 1})
