"""Test leaderboard musiman (SIM-17): auth gating, fail-soft 503, 404-delete, 422 validation.

Mirrors test_scenario_analytics.py: real verifier + fake JWKS with admin tokens; the DB is never
touched in these unit tests (200 cases monkeypatch the `metrics_db.*` fns with async stubs; the 503
cases either monkeypatch to raise or rely on the lifespan leaving `metrics_pool=None` so the real
fail-soft path runs). The auth-gate cases assert the DB is never reached (stub raises AssertionError).

Covers all THREE routes:
  GET    /admin/leaderboard
  POST   /admin/leaderboard/capture
  DELETE /admin/leaderboard/seasons/{season_id}
"""

from __future__ import annotations

import asyncio
import logging
import uuid

import asyncpg
import pytest
from pydantic import ValidationError

from api import metrics_db
from api.metrics_db import MetricsUnavailable


def _admin_token(token_factory) -> str:
    return token_factory(sub="admin-1", is_anonymous=False, is_admin=True)


SEASON_UUID = "11111111-1111-1111-1111-111111111111"

OVERVIEW_PATH = "/admin/leaderboard"
CAPTURE_PATH = "/admin/leaderboard/capture"
DELETE_PATH = f"/admin/leaderboard/seasons/{SEASON_UUID}"

OVERVIEW_SAMPLE = {
    "seasons": [
        {
            "id": "22222222-2222-2222-2222-222222222222",
            "season_number": 2,
            "label": "Awarding Day",
            "captured_at": "2026-10-09T04:00:00Z",
            "entry_count": 42,
        },
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "season_number": 1,
            "label": None,  # label nullable
            "captured_at": "2026-10-01T04:00:00Z",
            "entry_count": 10,
        },
    ],
    "selected": {
        "id": "22222222-2222-2222-2222-222222222222",
        "season_number": 2,
        "label": "Awarding Day",
        "captured_at": "2026-10-09T04:00:00Z",
        "entry_count": 42,
        "entries": [
            {"rank": 1, "display_name": "Budi", "xp": 1500, "level": 6},
            {"rank": 2, "display_name": "Anggota", "xp": 900, "level": 4},
        ],
    },
}

# No-season state: selected null (must still validate).
OVERVIEW_EMPTY = {"seasons": [], "selected": None}

CAPTURE_SAMPLE = {
    "season_id": "33333333-3333-3333-3333-333333333333",
    "season_number": 3,
    "captured_at": "2026-10-09T04:00:00Z",
    "entry_count": 42,
}

# 0-entry season is valid (empty player base).
CAPTURE_EMPTY = {
    "season_id": "44444444-4444-4444-4444-444444444444",
    "season_number": 4,
    "captured_at": "2026-10-09T04:00:00Z",
    "entry_count": 0,
}

DELETE_SAMPLE = {"deleted": True, "season_number": 3}
DELETE_ABSENT = {"deleted": False, "season_number": None}


# --------------------------------- monkeypatch helpers ------------------------------


def _patch_overview(monkeypatch, payload, holder=None):
    async def _fake(_pool, season_id):
        if holder is not None:
            holder["season_id"] = season_id
        return payload

    monkeypatch.setattr(metrics_db, "fetch_leaderboard_overview", _fake)


def _patch_capture(monkeypatch, payload, holder=None):
    async def _fake(_pool, label):
        if holder is not None:
            holder["label"] = label
        return payload

    monkeypatch.setattr(metrics_db, "capture_leaderboard_snapshot", _fake)


def _patch_delete(monkeypatch, payload):
    async def _fake(_pool, _season_id):
        return payload

    monkeypatch.setattr(metrics_db, "delete_leaderboard_season", _fake)


def _patch_all_boom(monkeypatch):
    """Stub all three fns to raise if reached — asserts the auth gate precedes any DB call."""

    async def _boom(*_a, **_k):
        raise AssertionError("metrics_db reached without passing the admin gate")

    monkeypatch.setattr(metrics_db, "fetch_leaderboard_overview", _boom)
    monkeypatch.setattr(metrics_db, "capture_leaderboard_snapshot", _boom)
    monkeypatch.setattr(metrics_db, "delete_leaderboard_season", _boom)


def _call(client, route, headers=None):
    """Hit a route with optional headers; capture uses a valid (empty) body so body-validation
    never masks an auth status we're asserting."""
    headers = headers or {}
    if route == "get":
        return client.get(OVERVIEW_PATH, headers=headers)
    if route == "capture":
        return client.post(CAPTURE_PATH, headers=headers, json={})
    if route == "delete":
        return client.delete(DELETE_PATH, headers=headers)
    raise AssertionError(f"unknown route {route!r}")


ROUTES = ["get", "capture", "delete"]


# --------------------------------- happy path ---------------------------------------


def test_admin_gets_overview_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_overview(monkeypatch, OVERVIEW_SAMPLE)
    resp = client.get(
        OVERVIEW_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["seasons"]) == 2
    assert body["seasons"][1]["label"] is None
    assert body["selected"]["season_number"] == 2
    assert body["selected"]["entries"][0] == {
        "rank": 1,
        "display_name": "Budi",
        "xp": 1500,
        "level": 6,
    }


def test_admin_gets_overview_with_season_id_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_overview(monkeypatch, OVERVIEW_SAMPLE, holder=holder)
    resp = client.get(
        OVERVIEW_PATH,
        params={"season_id": "22222222-2222-2222-2222-222222222222"},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 200
    # the query param is parsed to a uuid.UUID and forwarded to the DB fn (not a raw str)
    assert holder["season_id"] == uuid.UUID("22222222-2222-2222-2222-222222222222")
    assert isinstance(holder["season_id"], uuid.UUID)


def test_overview_empty_state_is_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_overview(monkeypatch, OVERVIEW_EMPTY)
    resp = client.get(
        OVERVIEW_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["seasons"] == []
    assert body["selected"] is None


def test_admin_captures_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_capture(monkeypatch, CAPTURE_SAMPLE)
    resp = client.post(
        CAPTURE_PATH,
        json={"label": "Awarding Day"},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["season_number"] == 3
    assert body["entry_count"] == 42


def test_capture_empty_season_is_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_capture(monkeypatch, CAPTURE_EMPTY)
    resp = client.post(
        CAPTURE_PATH, json={}, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert resp.status_code == 200
    assert resp.json()["entry_count"] == 0


def test_capture_passes_label_through(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_capture(monkeypatch, CAPTURE_SAMPLE, holder=holder)
    client.post(
        CAPTURE_PATH,
        json={"label": "Musim Panen"},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert holder["label"] == "Musim Panen"


def test_capture_omitted_label_is_none(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_capture(monkeypatch, CAPTURE_SAMPLE, holder=holder)
    client.post(
        CAPTURE_PATH, json={}, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert holder["label"] is None


def test_admin_deletes_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_delete(monkeypatch, DELETE_SAMPLE)
    resp = client.delete(
        DELETE_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True, "season_number": 3}


# --------------------------------- auth gating (all three) --------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_no_token_is_401(client, install_jwks, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)  # must 401 before any DB call
    assert _call(client, route).status_code == 401


@pytest.mark.parametrize("route", ROUTES)
def test_non_admin_is_403_and_db_never_touched(client, install_jwks, token_factory, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)
    token = token_factory(sub="u", is_anonymous=False)  # no is_admin claim
    resp = _call(client, route, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "forbidden"}


@pytest.mark.parametrize("route", ROUTES)
def test_anonymous_admin_is_403(client, install_jwks, token_factory, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)
    token = token_factory(sub="g", is_admin=True, is_anonymous=True)
    assert _call(client, route, headers={"Authorization": f"Bearer {token}"}).status_code == 403


@pytest.mark.parametrize("route", ROUTES)
def test_expired_token_is_401(client, install_jwks, token_factory, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)
    token = token_factory(exp_delta=-3600, is_admin=True, is_anonymous=False)
    assert _call(client, route, headers={"Authorization": f"Bearer {token}"}).status_code == 401


# --------------------------------- fail-soft 503 (all three) ------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_db_down_is_503_with_real_auth(client, install_jwks, token_factory, route):
    # No monkeypatch: lifespan left metrics_pool=None (METRICS_DB_URL unset) → real fail-soft → 503.
    install_jwks()
    resp = _call(client, route, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503
    assert resp.json() == {"detail": "metrics_unavailable"}


@pytest.mark.parametrize("route", ROUTES)
def test_metrics_unavailable_maps_to_503(client, install_jwks, token_factory, monkeypatch, route):
    install_jwks()

    async def _raise(*_a, **_k):
        raise MetricsUnavailable

    monkeypatch.setattr(metrics_db, "fetch_leaderboard_overview", _raise)
    monkeypatch.setattr(metrics_db, "capture_leaderboard_snapshot", _raise)
    monkeypatch.setattr(metrics_db, "delete_leaderboard_season", _raise)
    resp = _call(client, route, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503
    assert resp.json() == {"detail": "metrics_unavailable"}


def test_health_still_ok_when_db_down(client):
    # Fail-soft guarantee: the DB being unavailable never affects /health.
    assert client.get("/health").json() == {"status": "ok"}


# --------------------------------- validation (422 / 404) ---------------------------


def test_overview_malformed_season_id_is_422(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_all_boom(monkeypatch)  # 422 must precede any DB contact
    resp = client.get(
        OVERVIEW_PATH,
        params={"season_id": "not-a-uuid"},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_delete_malformed_season_id_is_422(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_all_boom(monkeypatch)
    resp = client.delete(
        "/admin/leaderboard/seasons/not-a-uuid",
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_capture_label_too_long_is_422(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_all_boom(monkeypatch)
    resp = client.post(
        CAPTURE_PATH,
        json={"label": "x" * 121},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_capture_empty_label_is_422(client, install_jwks, token_factory, monkeypatch):
    # "" is rejected at the boundary (min_length=1) rather than silently coerced; omit or send null.
    install_jwks()
    _patch_all_boom(monkeypatch)
    resp = client.post(
        CAPTURE_PATH,
        json={"label": ""},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_capture_unknown_body_key_is_422(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_all_boom(monkeypatch)
    resp = client.post(
        CAPTURE_PATH,
        json={"label": "ok", "surprise": 1},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_delete_absent_season_is_404(client, install_jwks, token_factory, monkeypatch):
    # {deleted:false} is a RETURN (not a raise) → route maps it to 404, not swallowed to 503.
    install_jwks()
    _patch_delete(monkeypatch, DELETE_ABSENT)
    resp = client.delete(
        DELETE_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert resp.status_code == 404
    assert resp.json() == {"detail": "season_not_found"}


# --------------------------------- server-side attribution log ----------------------


def test_capture_logs_attribution_without_label(client, install_jwks, token_factory, monkeypatch, caplog):
    install_jwks()
    _patch_capture(monkeypatch, CAPTURE_SAMPLE)
    secret = "RAHASIA-LABEL-xyz"
    with caplog.at_level(logging.INFO, logger="koperasi.token"):
        client.post(
            CAPTURE_PATH,
            json={"label": secret},
            headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
        )
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "admin-1" in text  # acting user_id attributed
    assert "musim #3" in text  # season_number (pinned, not a bare "3")
    assert secret not in text  # NEVER log the label


def test_delete_logs_attribution(client, install_jwks, token_factory, monkeypatch, caplog):
    install_jwks()
    _patch_delete(monkeypatch, DELETE_SAMPLE)
    with caplog.at_level(logging.INFO, logger="koperasi.token"):
        client.delete(
            DELETE_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
        )
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "admin-1" in text
    assert "musim #3" in text  # season_number (pinned, not a bare "3")


# --------------------------------- CORS ---------------------------------------------


def test_delete_preflight_allows_delete(client):
    resp = client.options(
        DELETE_PATH,
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5174"
    allow_methods = resp.headers.get("access-control-allow-methods", "")
    assert "DELETE" in allow_methods


def test_capture_preflight_allows_post(client):
    resp = client.options(
        CAPTURE_PATH,
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5174"


# ------------------------- metrics_db unit (fail-soft breadth) ----------------------
# Mirrors the _FakePool/_FakeConn pattern from test_scenario_analytics.py.


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


_A_UUID = uuid.UUID(SEASON_UUID)


# --- fetch_leaderboard_overview ---


def test_fetch_overview_none_pool_raises_unavailable():
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_leaderboard_overview(None, None))


def test_fetch_overview_interface_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("connection was closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_leaderboard_overview(pool, _A_UUID))


def test_fetch_overview_postgres_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_leaderboard_overview(pool, None))


def test_fetch_overview_returns_dict_on_success():
    pool = _FakePool(_FakeConn(value={"seasons": [], "selected": None}))
    assert asyncio.run(metrics_db.fetch_leaderboard_overview(pool, None)) == {
        "seasons": [],
        "selected": None,
    }


def test_fetch_overview_null_row_maps_to_unavailable():
    pool = _FakePool(_FakeConn(value=None))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.fetch_leaderboard_overview(pool, None))


# --- capture_leaderboard_snapshot ---


def test_capture_none_pool_raises_unavailable():
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.capture_leaderboard_snapshot(None, None))


def test_capture_interface_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("connection was closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.capture_leaderboard_snapshot(pool, "label"))


def test_capture_postgres_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.capture_leaderboard_snapshot(pool, None))


def test_capture_returns_dict_on_success():
    pool = _FakePool(_FakeConn(value=CAPTURE_SAMPLE))
    assert asyncio.run(metrics_db.capture_leaderboard_snapshot(pool, "x")) == CAPTURE_SAMPLE


def test_capture_null_row_maps_to_unavailable():
    pool = _FakePool(_FakeConn(value=None))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.capture_leaderboard_snapshot(pool, None))


# --- delete_leaderboard_season ---


def test_delete_none_pool_raises_unavailable():
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.delete_leaderboard_season(None, _A_UUID))


def test_delete_interface_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("connection was closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.delete_leaderboard_season(pool, _A_UUID))


def test_delete_postgres_error_maps_to_unavailable():
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.delete_leaderboard_season(pool, _A_UUID))


def test_delete_returns_dict_on_success():
    pool = _FakePool(_FakeConn(value=DELETE_SAMPLE))
    assert asyncio.run(metrics_db.delete_leaderboard_season(pool, _A_UUID)) == DELETE_SAMPLE


def test_delete_null_row_maps_to_unavailable():
    pool = _FakePool(_FakeConn(value=None))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(metrics_db.delete_leaderboard_season(pool, _A_UUID))


# ------------------------- response models (frozen contract) ------------------------


def test_overview_response_model_forbids_extra_keys():
    from api.server import LeaderboardOverviewResponse

    with pytest.raises(ValidationError):
        LeaderboardOverviewResponse(**{**OVERVIEW_SAMPLE, "surprise": 1})


def test_capture_response_model_forbids_extra_keys():
    from api.server import CaptureResultResponse

    with pytest.raises(ValidationError):
        CaptureResultResponse(**{**CAPTURE_SAMPLE, "surprise": 1})


def test_delete_response_model_forbids_extra_keys():
    from api.server import DeleteResultResponse

    with pytest.raises(ValidationError):
        DeleteResultResponse(**{**DELETE_SAMPLE, "surprise": 1})


def test_overview_model_accepts_null_selected_and_null_label():
    from api.server import LeaderboardOverviewResponse

    model = LeaderboardOverviewResponse(**OVERVIEW_SAMPLE)
    assert model.selected is not None
    assert model.seasons[1].label is None
    # empty state validates too
    assert LeaderboardOverviewResponse(**OVERVIEW_EMPTY).selected is None


def test_delete_model_accepts_null_season_number():
    from api.server import DeleteResultResponse

    assert DeleteResultResponse(**DELETE_ABSENT).season_number is None
