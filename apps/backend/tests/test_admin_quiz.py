"""Test quiz content management (SIM-18): auth gating, fail-soft 503, Pydantic 422 at the
boundary, and structured-reason → 404/409 mapping (NOT 503).

Mirrors test_leaderboard.py: real verifier + fake JWKS with admin tokens; the DB is never
touched (200 cases monkeypatch metrics_db.* with async stubs; 503 cases raise or rely on the
lifespan leaving metrics_pool=None). The load-bearing invariant: because _call_definer turns any
RAISE into a 503, input rejections must be 422 at Pydantic and state rejections must be structured
RETURNs the route maps to 404/409 — so these tests pin those statuses away from 503.

Routes:
  GET    /admin/quiz
  POST   /admin/quiz
  DELETE /admin/quiz/{code}
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

import asyncpg
import pytest
from pydantic import ValidationError

from api import metrics_db
from api.metrics_db import MetricsUnavailable


def _admin_token(token_factory) -> str:
    return token_factory(sub="admin-1", is_anonymous=False, is_admin=True)


LIST_PATH = "/admin/quiz"
UPSERT_PATH = "/admin/quiz"
DELETE_PATH = "/admin/quiz/q1"

TS = "2026-10-11T09:00:00.000000Z"

LIST_SAMPLE = {
    "ok": True,
    "rows": [
        {"code": "q1", "prompt": "P1", "options": ["a", "b", "c"], "correct_index": 2,
         "explanation": "karena a", "sort_order": 0, "updated_at": TS},
        {"code": "q2", "prompt": "P2", "options": ["a", "b"], "correct_index": 0,
         "explanation": None, "sort_order": 1, "updated_at": "2026-10-11T09:01:00.000000Z"},
    ],
}

ROW_SAMPLE = {
    "ok": True,
    "row": {"code": "q3", "prompt": "P3", "options": ["a", "b", "c"], "correct_index": 1,
            "explanation": "e3", "sort_order": 5, "updated_at": "2026-10-11T09:02:00.000000Z"},
}

VALID_BODY = {
    "code": "q3", "prompt": "P3", "options": ["a", "b", "c"],
    "correct_index": 1, "explanation": "e3", "sort_order": 5,
}


# --------------------------------- monkeypatch helpers ------------------------------


def _patch_list(monkeypatch, payload):
    async def _fake(_pool):
        return payload

    monkeypatch.setattr(metrics_db, "list_quiz", _fake)


def _patch_upsert(monkeypatch, payload, holder=None):
    async def _fake(_pool, **kw):
        if holder is not None:
            holder.update(kw)
        return payload

    monkeypatch.setattr(metrics_db, "upsert_quiz_question", _fake)


def _patch_delete(monkeypatch, payload):
    async def _fake(_pool, **_kw):
        return payload

    monkeypatch.setattr(metrics_db, "delete_quiz_question", _fake)


def _patch_all_boom(monkeypatch):
    """Stub all three fns to raise if reached — asserts the gate / boundary precedes any DB call."""

    async def _boom(*_a, **_k):
        raise AssertionError("metrics_db reached without passing the admin gate / validation")

    monkeypatch.setattr(metrics_db, "list_quiz", _boom)
    monkeypatch.setattr(metrics_db, "upsert_quiz_question", _boom)
    monkeypatch.setattr(metrics_db, "delete_quiz_question", _boom)


def _call(client, route, headers=None):
    headers = headers or {}
    if route == "list":
        return client.get(LIST_PATH, headers=headers)
    if route == "upsert":
        return client.post(UPSERT_PATH, headers=headers, json=VALID_BODY)
    if route == "delete":
        return client.delete(DELETE_PATH, headers=headers)
    raise AssertionError(f"unknown route {route!r}")


ROUTES = ["list", "upsert", "delete"]


# --------------------------------- happy path ---------------------------------------


def test_admin_lists_quiz_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_list(monkeypatch, LIST_SAMPLE)
    resp = client.get(LIST_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["rows"]) == 2
    # the admin read exposes the hidden answer key (quiz_catalog omits it)
    assert body["rows"][0]["correct_index"] == 2
    assert body["rows"][1]["explanation"] is None


def test_admin_creates_question_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_upsert(monkeypatch, ROW_SAMPLE, holder=holder)
    resp = client.post(
        UPSERT_PATH, json=VALID_BODY,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 200
    assert resp.json()["code"] == "q3"
    # CREATE: no CAS token → prev_updated_at forwarded as None; options forwarded as a list
    assert holder["prev_updated_at"] is None
    assert holder["options"] == ["a", "b", "c"]


def test_edit_parses_cas_token_to_datetime(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    holder: dict = {}
    _patch_upsert(monkeypatch, ROW_SAMPLE, holder=holder)
    client.post(
        UPSERT_PATH, json={**VALID_BODY, "prev_updated_at": TS},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    # the CAS token is parsed to an aware datetime at the boundary (not forwarded as a raw str)
    assert isinstance(holder["prev_updated_at"], datetime)
    assert holder["prev_updated_at"].utcoffset() is not None


def test_admin_deletes_question_200(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_delete(monkeypatch, {"ok": True, "deleted": True})
    resp = client.delete(
        DELETE_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}


# --------------------------------- auth gating (all three) --------------------------


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

    monkeypatch.setattr(metrics_db, "list_quiz", _raise)
    monkeypatch.setattr(metrics_db, "upsert_quiz_question", _raise)
    monkeypatch.setattr(metrics_db, "delete_quiz_question", _raise)
    resp = _call(client, route, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 503


# --------------------------------- validation (422 at the Pydantic boundary) --------


@pytest.mark.parametrize(
    "body",
    [
        {**VALID_BODY, "surprise": 1},                 # unknown key (extra="forbid")
        {**VALID_BODY, "options": ["a"]},              # too few options
        {**VALID_BODY, "options": ["a", "b", "c", "d", "e"]},  # too many options
        {**VALID_BODY, "correct_index": 5},            # out of range for 3 options (cross-field)
        {**VALID_BODY, "code": ""},                    # empty code
        {**VALID_BODY, "sort_order": -1},              # negative sort_order
        {k: v for k, v in VALID_BODY.items() if k != "prompt"},  # missing required prompt
    ],
)
def test_upsert_invalid_body_is_422(client, install_jwks, token_factory, monkeypatch, body):
    install_jwks()
    _patch_all_boom(monkeypatch)  # 422 must precede any DB contact
    resp = client.post(
        UPSERT_PATH, json=body,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


def test_upsert_malformed_cas_token_is_422(client, install_jwks, token_factory, monkeypatch):
    install_jwks()
    _patch_all_boom(monkeypatch)  # the bad timestamp is rejected before the RPC
    resp = client.post(
        UPSERT_PATH, json={**VALID_BODY, "prev_updated_at": "not-a-timestamp"},
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == 422


# --------------------------------- structured reason → status (never 503) -----------


@pytest.mark.parametrize(
    ("reason", "status"),
    [
        ("duplicate_code", 409),
        ("stale_write", 409),
        ("not_found", 404),
        ("options_len", 422),            # defense-in-depth reason from SQL
        ("correct_index_range", 422),
        ("totally_unknown", 409),        # unmapped ok:false defaults to 409, NEVER 200
    ],
)
def test_upsert_reason_maps_to_status(client, install_jwks, token_factory, monkeypatch, reason, status):
    install_jwks()
    _patch_upsert(monkeypatch, {"ok": False, "reason": reason})
    resp = client.post(
        UPSERT_PATH, json=VALID_BODY,
        headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
    )
    assert resp.status_code == status
    assert resp.status_code != 503


@pytest.mark.parametrize(
    ("reason", "status"),
    [("has_completions", 409), ("not_found", 404)],
)
def test_delete_reason_maps_to_status(client, install_jwks, token_factory, monkeypatch, reason, status):
    install_jwks()
    _patch_delete(monkeypatch, {"ok": False, "deleted": False, "reason": reason})
    resp = client.delete(
        DELETE_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"}
    )
    assert resp.status_code == status
    assert resp.status_code != 503


# --------------------------------- attribution log (no content) ---------------------


def test_upsert_logs_attribution_without_content(client, install_jwks, token_factory, monkeypatch, caplog):
    install_jwks()
    _patch_upsert(monkeypatch, ROW_SAMPLE)
    secret_prompt = "RAHASIA-PROMPT-xyz"
    with caplog.at_level(logging.INFO, logger="koperasi.token"):
        client.post(
            UPSERT_PATH, json={**VALID_BODY, "prompt": secret_prompt},
            headers={"Authorization": f"Bearer {_admin_token(token_factory)}"},
        )
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "admin-1" in text        # acting user_id
    assert "q3" in text             # code (non-PII)
    assert secret_prompt not in text  # NEVER log the content


def test_delete_logs_attribution(client, install_jwks, token_factory, monkeypatch, caplog):
    install_jwks()
    _patch_delete(monkeypatch, {"ok": True, "deleted": True})
    with caplog.at_level(logging.INFO, logger="koperasi.token"):
        client.delete(DELETE_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "admin-1" in text
    assert "q1" in text


# --------------------------------- response models / fault detection ----------------


def test_list_response_model_forbids_extra_keys():
    from api.server import ListQuizResponse

    with pytest.raises(ValidationError):
        ListQuizResponse(**{**LIST_SAMPLE, "surprise": 1})


def test_list_extra_response_key_is_500_not_leaked(install_jwks, token_factory, monkeypatch):
    # A backend returning a wrong shape is a FAULT: ResponseValidationError → 500 (not 2xx).
    # Use a non-raising TestClient so the framework's 500 response is observed, not re-raised.
    from fastapi.testclient import TestClient

    from api import server

    install_jwks()
    _patch_list(monkeypatch, {**LIST_SAMPLE, "surprise": 1})
    with TestClient(server.app, raise_server_exceptions=False) as c:
        resp = c.get(LIST_PATH, headers={"Authorization": f"Bearer {_admin_token(token_factory)}"})
    assert resp.status_code == 500


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


def _run_list(pool):
    return metrics_db.list_quiz(pool)


def _run_upsert(pool):
    return metrics_db.upsert_quiz_question(
        pool, code="q", prompt="p", options=["a", "b"], correct_index=0,
        explanation=None, sort_order=0, prev_updated_at=None,
    )


def _run_delete(pool):
    return metrics_db.delete_quiz_question(pool, code="q")


@pytest.mark.parametrize("runner", [_run_list, _run_upsert, _run_delete])
def test_none_pool_raises_unavailable(runner):
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(None))


@pytest.mark.parametrize("runner", [_run_list, _run_upsert, _run_delete])
def test_interface_error_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(exc=asyncpg.InterfaceError("connection was closed")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


@pytest.mark.parametrize("runner", [_run_list, _run_upsert, _run_delete])
def test_postgres_error_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(exc=asyncpg.PostgresError("boom")))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


@pytest.mark.parametrize("runner", [_run_list, _run_upsert, _run_delete])
def test_null_row_maps_to_unavailable(runner):
    pool = _FakePool(_FakeConn(value=None))
    with pytest.raises(MetricsUnavailable):
        asyncio.run(runner(pool))


def test_upsert_forwards_options_as_list_for_codec(monkeypatch):
    # The jsonb options bind relies on the connection codec encoding a Python list — so the
    # wrapper must forward a list (not a pre-serialized str) as the $3 positional arg.
    captured: dict = {}

    async def _fake_call(_pool, _sql, *args, **_kw):
        captured["args"] = args
        return {"ok": True, "row": {}}

    monkeypatch.setattr(metrics_db, "_call_definer", _fake_call)
    asyncio.run(_run_upsert(_FakePool(_FakeConn(value=None))))
    # positional order: code, prompt, options, correct_index, explanation, sort_order, prev_updated_at
    assert captured["args"][2] == ["a", "b"]
    assert isinstance(captured["args"][2], list)
