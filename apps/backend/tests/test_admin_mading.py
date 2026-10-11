"""Test mading content management (SIM-18): auth gating, fail-soft 503, per-board Pydantic 422 at
the boundary (discriminated knowledge union + rectangular data), and structured-reason → status.

Mirrors test_admin_quiz.py. Routes:
  GET    /admin/mading
  POST   /admin/mading            (create)
  POST   /admin/mading/{id}       (edit — requires the CAS token)
  DELETE /admin/mading/{id}
"""

from __future__ import annotations

import asyncio
from datetime import datetime

import asyncpg
import pytest
from pydantic import ValidationError

from api import metrics_db
from api.metrics_db import MetricsUnavailable


def _admin_token(token_factory) -> str:
    return token_factory(sub="admin-1", is_anonymous=False, is_admin=True)


MID = "11111111-1111-1111-1111-111111111111"
TS = "2026-10-11T09:00:00.000000Z"

INFO = {"title": "T", "lines": ["a"], "accent": "mustard"}
DATA = {"title": "T", "headers": ["H1", "H2"], "rows": [["a", "b"]]}
KN = {"kind": "stat", "value": "1", "label": "L"}
IDENT = {"nama": "N", "badanHukum": "B", "alamat": "A", "desa": "D"}

CREATE_INFO = {"board": "info", "block_key": "k1", "payload": INFO, "sort_order": 0}
EDIT_INFO = {"board": "info", "payload": INFO, "sort_order": 0, "prev_updated_at": TS}

ROW_SAMPLE = {
    "id": MID,
    "board": "info",
    "block_key": "k1",
    "payload": INFO,
    "sort_order": 0,
    "updated_at": TS,
}
LIST_SAMPLE = {"ok": True, "groups": {"info": [], "data": [], "knowledge": [], "identitas": None}}


def _patch_list(monkeypatch, payload):
    async def _fake(_pool):
        return payload

    monkeypatch.setattr(metrics_db, "list_mading", _fake)


def _patch_upsert(monkeypatch, payload, holder=None):
    async def _fake(_pool, **kw):
        if holder is not None:
            holder.update(kw)
        return payload

    monkeypatch.setattr(metrics_db, "upsert_mading_block", _fake)


def _patch_delete(monkeypatch, payload):
    async def _fake(_pool, **_kw):
        return payload

    monkeypatch.setattr(metrics_db, "delete_mading_block", _fake)


def _patch_all_boom(monkeypatch):
    async def _boom(*_a, **_k):
        raise AssertionError("metrics_db reached without passing the gate / validation")

    monkeypatch.setattr(metrics_db, "list_mading", _boom)
    monkeypatch.setattr(metrics_db, "upsert_mading_block", _boom)
    monkeypatch.setattr(metrics_db, "delete_mading_block", _boom)


def _call(client, route, headers=None):
    headers = headers or {}
    if route == "list":
        return client.get("/admin/mading", headers=headers)
    if route == "create":
        return client.post("/admin/mading", headers=headers, json=CREATE_INFO)
    if route == "edit":
        return client.post(f"/admin/mading/{MID}", headers=headers, json=EDIT_INFO)
    if route == "delete":
        return client.delete(f"/admin/mading/{MID}", headers=headers)
    raise AssertionError(f"unknown route {route!r}")


ROUTES = ["list", "create", "edit", "delete"]


# --------------------------------- happy path ---------------------------------------


def test_list_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_list(monkeypatch, LIST_SAMPLE)
    resp = client.get("/admin/mading", headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 200
    assert resp.json()["groups"]["info"] == []


def test_create_200_forwards_args(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_upsert(monkeypatch, {"ok": True, "row": ROW_SAMPLE}, holder=holder)
    resp = client.post(
        "/admin/mading", json=CREATE_INFO,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 200
    assert resp.json()["block_key"] == "k1"
    assert holder["block_id"] is None  # CREATE
    assert holder["board"] == "info"
    assert holder["payload"] == INFO
    assert holder["prev_updated_at"] is None


def test_edit_200_parses_cas_token(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_upsert(monkeypatch, {"ok": True, "row": ROW_SAMPLE}, holder=holder)
    resp = client.post(
        f"/admin/mading/{MID}", json=EDIT_INFO,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 200
    assert str(holder["block_id"]) == MID
    assert isinstance(holder["prev_updated_at"], datetime)


def test_delete_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_delete(monkeypatch, {"ok": True, "deleted": True})
    resp = client.delete(f"/admin/mading/{MID}", headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}


# --------------------------------- auth gating --------------------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_no_token_is_401(client, install_jwks, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)
    assert _call(client, route).status_code == 401


@pytest.mark.parametrize("route", ROUTES)
def test_non_admin_is_403(client, install_jwks, token_factory, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)
    token = token_factory(sub="u", is_anonymous=False)
    assert _call(client, route, headers={"Authorization": f"Bearer {token}"}).status_code == 403


@pytest.mark.parametrize("route", ROUTES)
def test_anonymous_admin_is_403(client, install_jwks, token_factory, monkeypatch, route):
    install_jwks()
    _patch_all_boom(monkeypatch)
    token = token_factory(sub="g", is_admin=True, is_anonymous=True)
    assert _call(client, route, headers={"Authorization": f"Bearer {token}"}).status_code == 403


# --------------------------------- fail-soft 503 ------------------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_db_down_is_503(client, install_jwks, token_factory, route):
    install_jwks()
    resp = _call(client, route, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503


# --------------------------------- validation (422 at the Pydantic boundary) --------


@pytest.mark.parametrize(
    "body",
    [
        {**CREATE_INFO, "surprise": 1},                                      # unknown body key
        {**CREATE_INFO, "board": "bogus"},                                   # board not in Literal
        {**CREATE_INFO, "payload": {**INFO, "accent": "neon"}},              # bad accent
        {"board": "data", "block_key": "k", "payload": {"title": "T", "headers": ["H1", "H2"], "rows": [["a"]]}},  # row != headers
        {"board": "knowledge", "block_key": "k", "payload": {"kind": "quote", "text": "x"}},  # unknown kind
        {"board": "knowledge", "block_key": "k", "payload": {"kind": "stat", "value": "1", "label": "L", "text": "x"}},  # foreign key
        {"board": "info", "payload": INFO},                                  # missing block_key (create)
    ],
)
def test_create_invalid_is_422(client, install_jwks, token_factory, monkeypatch, body):
    install_jwks()
    _patch_all_boom(monkeypatch)
    resp = client.post(
        "/admin/mading", json=body,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_edit_missing_cas_is_422(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_all_boom(monkeypatch)
    resp = client.post(
        f"/admin/mading/{MID}", json={"board": "info", "payload": INFO, "sort_order": 0},  # no prev_updated_at
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_edit_malformed_id_is_422(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_all_boom(monkeypatch)
    resp = client.post(
        "/admin/mading/not-a-uuid", json=EDIT_INFO,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


# --------------------------------- structured reason → status (never 503) -----------


@pytest.mark.parametrize(
    ("reason", "status"),
    [("duplicate_key", 409), ("identitas_exists", 409), ("info_accent", 422), ("unknown_board", 422)],
)
def test_create_reason_maps_to_status(client, install_jwks, token_factory, monkeypatch, reason, status):
    install_jwks()
    _patch_upsert(monkeypatch, {"ok": False, "reason": reason})
    resp = client.post(
        "/admin/mading", json=CREATE_INFO,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == status
    assert resp.status_code != 503


@pytest.mark.parametrize(("reason", "status"), [("stale_write", 409), ("not_found", 404)])
def test_edit_reason_maps_to_status(client, install_jwks, token_factory, monkeypatch, reason, status):
    install_jwks()
    _patch_upsert(monkeypatch, {"ok": False, "reason": reason})
    resp = client.post(
        f"/admin/mading/{MID}", json=EDIT_INFO,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == status


def test_delete_not_found_is_404(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_delete(monkeypatch, {"ok": False, "deleted": False, "reason": "not_found"})
    resp = client.delete(f"/admin/mading/{MID}", headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 404


# --------------------------------- payload models / response contract ---------------


def test_data_payload_rejects_jagged_rows_directly():
    from api.server import DataPayload

    with pytest.raises(ValidationError):
        DataPayload(title="T", headers=["H1", "H2"], rows=[["only-one"]])


def test_knowledge_adapter_rejects_unknown_kind():
    from api.server import _knowledge_adapter

    with pytest.raises(ValidationError):
        _knowledge_adapter.validate_python({"kind": "quote", "text": "x"})


def test_list_response_model_forbids_extra():
    from api.server import ListMadingResponse

    with pytest.raises(ValidationError):
        ListMadingResponse(**{**LIST_SAMPLE, "surprise": 1})


# --------------------------------- metrics_db unit (fail-soft breadth) --------------


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


import uuid  # noqa: E402

_A_UUID = uuid.UUID(MID)


def _run_list(pool):
    return metrics_db.list_mading(pool)


def _run_upsert(pool):
    return metrics_db.upsert_mading_block(
        pool, block_id=None, board="info", block_key="k", payload=INFO, sort_order=0, prev_updated_at=None,
    )


def _run_delete(pool):
    return metrics_db.delete_mading_block(pool, block_id=_A_UUID)


@pytest.mark.parametrize("runner", [_run_list, _run_upsert, _run_delete])
def test_none_pool_raises_unavailable(runner):
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(None))


@pytest.mark.parametrize("runner", [_run_list, _run_upsert, _run_delete])
def test_interface_error_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


@pytest.mark.parametrize("runner", [_run_list, _run_upsert, _run_delete])
def test_null_row_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(value=None))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


def test_upsert_forwards_payload_as_dict(monkeypatch):
    captured: dict = {}

    async def _fake_call(_pool, _sql, *args, **_kw):
        captured["args"] = args
        return {"ok": True, "row": {}}

    monkeypatch.setattr(metrics_db, "_call_definer", _fake_call)
    asyncio.run(_run_upsert(_FakePool(_FakeConn(value=None))))
    # positional: block_id, board, block_key, payload, sort_order, prev_updated_at
    assert captured["args"][3] == INFO
    assert isinstance(captured["args"][3], dict)
