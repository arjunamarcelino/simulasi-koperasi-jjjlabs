"""Test mission unlock-code rotation (SIM-42): auth gating, fail-soft 503, Pydantic 422 at
the boundary, structured-reason → 404/422 (NOT 503), actor forwarding, and log scrubbing.

Mirrors test_admin_quiz.py: real verifier + fake JWKS with admin tokens; the DB is never
touched (200 cases monkeypatch metrics_db.* with async stubs; 503 cases raise or rely on the
lifespan leaving metrics_pool=None). Rotate-only scope: there is NO create/delete route and
NO CAS token (last-write-wins).

Routes:
  GET  /admin/missions
  POST /admin/missions/{code}
"""

from __future__ import annotations

import asyncio
import logging

import asyncpg
import pytest

from api import metrics_db
from api.metrics_db import MetricsUnavailable


def _admin_token(token_factory) -> str:
    return token_factory(sub="admin-1", is_anonymous=False, is_admin=True)


LIST_PATH = "/admin/missions"
ROTATE_PATH = "/admin/missions/kunjungi-kdmp"  # POST /admin/missions/{code}

TS = "2026-10-14T09:00:00.000000Z"

LIST_SAMPLE = {
    "ok": True,
    "rows": [
        {"code": "kunjungi-kdmp", "title": "Kunjungi KDMP", "redeem_code": "KDMP2026",
         "redeem_code_updated_at": None, "redeem_code_updated_by": None},
        {"code": "impact-umkm", "title": "Koperasi Impact Mission", "redeem_code": "UMKM2026",
         "redeem_code_updated_at": TS, "redeem_code_updated_by": "admin-1"},
    ],
}

ROW_SAMPLE = {
    "ok": True,
    "row": {"code": "kunjungi-kdmp", "title": "Kunjungi KDMP", "redeem_code": "NEW2026",
            "redeem_code_updated_at": TS, "redeem_code_updated_by": "admin-1"},
}

VALID_BODY = {"redeem_code": "NEW2026"}


# --------------------------------- monkeypatch helpers ------------------------------


def _patch_list(monkeypatch, payload):
    async def _fake(_pool):
        return payload

    monkeypatch.setattr(metrics_db, "list_missions", _fake)


def _patch_set(monkeypatch, payload, holder=None):
    async def _fake(_pool, **kw):
        if holder is not None:
            holder.update(kw)
        return payload

    monkeypatch.setattr(metrics_db, "set_mission_redeem_code", _fake)


def _patch_all_boom(monkeypatch):
    """Stub both fns to raise if reached — asserts the gate / boundary precedes any DB call."""

    async def _boom(*_a, **_k):
        raise AssertionError("metrics_db reached without passing the admin gate / validation")

    monkeypatch.setattr(metrics_db, "list_missions", _boom)
    monkeypatch.setattr(metrics_db, "set_mission_redeem_code", _boom)


def _call(client, route, headers=None):
    headers = headers or {}
    if route == "list":
        return client.get(LIST_PATH, headers=headers)
    if route == "rotate":
        return client.post(ROTATE_PATH, headers=headers, json=VALID_BODY)
    raise AssertionError(f"unknown route {route!r}")


ROUTES = ["list", "rotate"]


# --------------------------------- happy path ---------------------------------------


def test_admin_lists_missions_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_list(monkeypatch, LIST_SAMPLE)
    resp = client.get(LIST_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["rows"]) == 2
    # the admin read exposes the hidden redeem_code (mission_catalog omits it)
    assert body["rows"][0]["redeem_code"] == "KDMP2026"
    # never-rotated row surfaces NULL audit
    assert body["rows"][0]["redeem_code_updated_at"] is None


def test_admin_rotates_code_200_and_forwards_actor(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_set(monkeypatch, ROW_SAMPLE, holder=holder)
    resp = client.post(
        ROTATE_PATH, json=VALID_BODY,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 200
    assert resp.json()["redeem_code"] == "NEW2026"
    # code from the path; the admin's JWT user_id forwarded as the audit actor
    assert holder["code"] == "kunjungi-kdmp"
    assert holder["redeem_code"] == "NEW2026"
    assert holder["actor"] == "admin-1"


# --------------------------------- auth gating (both routes) ------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_no_token_is_401(client, install_jwks, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)
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


# --------------------------------- rotate-only scope (no create/delete) -------------


def test_no_collection_post_or_delete_route():
    # Scope guard: only GET /admin/missions and POST /admin/missions/{code} exist.
    from api.server import app

    routes = {(r.path, m) for r in app.routes for m in getattr(r, "methods", set()) or set()}
    assert ("/admin/missions", "POST") not in routes       # no create-collection
    assert ("/admin/missions/{code}", "DELETE") not in routes  # no delete


# --------------------------------- fail-soft 503 ------------------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_db_down_is_503_with_real_auth(client, install_jwks, token_factory, route):
    install_jwks()  # lifespan left metrics_pool=None → real fail-soft → 503
    resp = _call(client, route, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503
    assert resp.json() == {"detail": "metrics_unavailable"}


@pytest.mark.parametrize("route", ROUTES)
def test_metrics_unavailable_maps_to_503(client, install_jwks, token_factory, monkeypatch, route):
    install_jwks()

    async def _raise(*_a, **_k):
        raise MetricsUnavailable

    monkeypatch.setattr(metrics_db, "list_missions", _raise)
    monkeypatch.setattr(metrics_db, "set_mission_redeem_code", _raise)
    resp = _call(client, route, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503


# --------------------------------- validation (422 at the Pydantic boundary) --------


@pytest.mark.parametrize(
    "body",
    [
        {"redeem_code": "X", "surprise": 1},  # unknown key (extra="forbid")
        {},                                    # missing redeem_code
        {"redeem_code": ""},                  # empty
        {"redeem_code": "   "},               # whitespace-only (str_strip_whitespace → "" → min_length fails)
        {"redeem_code": "x" * 65},            # over max_length (trimmed)
    ],
)
def test_rotate_invalid_body_is_422(client, install_jwks, token_factory, monkeypatch, body):
    install_jwks()
    _patch_all_boom(monkeypatch)  # 422 must precede any DB contact
    resp = client.post(
        ROTATE_PATH, json=body,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


# --------------------------------- structured reason → status (never 503) -----------


@pytest.mark.parametrize(
    ("reason", "status"),
    [
        ("not_found", 404),
        ("empty_redeem_code", 422),   # defense-in-depth reason from SQL
        ("too_long", 422),
        ("totally_unknown", 422),     # unmapped ok:false defaults to 422, NEVER 200 or 409 or 503
    ],
)
def test_rotate_reason_maps_to_status(client, install_jwks, token_factory, monkeypatch, reason, status):
    install_jwks()
    _patch_set(monkeypatch, {"ok": False, "reason": reason})
    resp = client.post(
        ROTATE_PATH, json=VALID_BODY,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == status
    assert resp.status_code != 503


# --------------------------------- attribution log (no secret) ----------------------


def test_rotate_logs_attribution_without_code_value(client, install_jwks, token_factory, monkeypatch, caplog):
    install_jwks()
    _patch_set(monkeypatch, ROW_SAMPLE)
    secret_code = "RAHASIA-CODE-xyz"
    with caplog.at_level(logging.INFO, logger="koperasi.token"):
        client.post(
            ROTATE_PATH, json={"redeem_code": secret_code},
            headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
        )
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "admin-1" in text          # acting user_id
    assert "kunjungi-kdmp" in text    # mission code (non-PII)
    assert secret_code not in text    # NEVER log the redeem_code value


# --------------------------------- response models / fault detection ----------------


def test_list_extra_response_key_is_500_not_leaked(install_jwks, token_factory, monkeypatch):
    # A backend returning a wrong shape is a FAULT: ResponseValidationError → 500 (not 2xx).
    from fastapi.testclient import TestClient

    from api import server

    install_jwks()
    _patch_list(monkeypatch, {**LIST_SAMPLE, "surprise": 1})
    with TestClient(server.app, raise_server_exceptions=False) as c:
        resp = c.get(LIST_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 500


# --------------------------------- metrics_db unit (fail-soft + binding) ------------


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


def _run_list(pool):
    return metrics_db.list_missions(pool)


def _run_set(pool):
    return metrics_db.set_mission_redeem_code(pool, code="kunjungi-kdmp", redeem_code="NEW", actor="admin-1")


@pytest.mark.parametrize("runner", [_run_list, _run_set])
def test_none_pool_raises_unavailable(runner):
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(None))


@pytest.mark.parametrize("runner", [_run_list, _run_set])
def test_interface_error_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("connection was closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


@pytest.mark.parametrize("runner", [_run_list, _run_set])
def test_postgres_error_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


@pytest.mark.parametrize("runner", [_run_list, _run_set])
def test_null_row_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(value=None))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


def test_set_forwards_positional_args_in_order(monkeypatch):
    # The $1,$2,$3 bind maps to (code, redeem_code, actor) — a positional-transposition guard.
    # This is the only unit-level place the actor str/uuid shape surfaces short of live e2e.
    captured: dict = {}

    async def _fake_call(_pool, _sql, *args, **_kw):
        captured["sql"] = _sql
        captured["args"] = args
        return {"ok": True, "row": {}}

    monkeypatch.setattr(metrics_db, "_call_definer", _fake_call)
    asyncio.run(_run_set(_FakePool(_FakeConn(value=None))))
    assert captured["args"] == ("kunjungi-kdmp", "NEW", "admin-1")
    assert "$3::uuid" in captured["sql"]  # Postgres does the text→uuid cast


def test_set_fault_log_scrubs_redeem_code(caplog):
    # On a DB fault, _call_definer logs the mission code (log_arg) but NEVER the redeem_code ($2).
    secret_code = "RAHASIA-CODE-abc"
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with (
        caplog.at_level(logging.ERROR, logger="koperasi.metrics"),
        pytest.raises(MetricsUnavailable),
    ):
        asyncio.run(
            metrics_db.set_mission_redeem_code(
                pool, code="kunjungi-kdmp", redeem_code=secret_code, actor="admin-1"
            )
        )
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "kunjungi-kdmp" in text      # the non-PII mission code is logged
    assert secret_code not in text      # the redeem_code value is NOT
