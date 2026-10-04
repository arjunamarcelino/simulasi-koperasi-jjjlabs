"""Test gerbang admin (SIM-14): `require_role('admin')` + `GET /admin/me`.

Perilaku auth diuji lewat verifier ASLI + JWKS palsu (install_jwks) dengan token
yang menyuntik klaim `is_admin` via token_factory(**extra). Urutan status
(401 sebelum 403) dan parse ketat fail-closed adalah inti kontrak.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.auth import AuthedUser, require_role


def _admin(**over):
    base = {"sub": "admin-1", "is_anonymous": False, "is_admin": True}
    base.update(over)
    return base


# ----------------------------- /admin/me (verifier ASLI) -----------------------------


def test_admin_token_reaches_admin_me(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(**_admin())
    resp = client.get("/admin/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "admin-1"}  # body carries only user_id; authz = status


def test_authenticated_non_admin_is_403(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False)  # no is_admin claim
    resp = client.get("/admin/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "forbidden"}  # body minimal, tak bocorkan sebab


def test_is_admin_false_is_403(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False, is_admin=False)
    resp = client.get("/admin/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_no_token_is_401_before_role_check(client, install_jwks):
    install_jwks()
    resp = client.get("/admin/me")
    assert resp.status_code == 401
    assert resp.headers.get("www-authenticate") == "Bearer"


def test_expired_token_is_401(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(exp_delta=-3600, is_admin=True, is_anonymous=False)
    resp = client.get("/admin/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_anonymous_admin_is_403(client, install_jwks, token_factory):
    # Keputusan SIM-14: tak ada admin anonim. is_admin:true + is_anonymous:true → 403.
    install_jwks()
    token = token_factory(sub="guest-admin", is_admin=True, is_anonymous=True)
    resp = client.get("/admin/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "forbidden"}  # sama persis dgn non-admin (tak bocor)


@pytest.mark.parametrize("bad", ["true", 1, 0, None, "false", "1"])
def test_non_bool_is_admin_is_403(client, install_jwks, token_factory, bad):
    # Parse KETAT fail-closed: hanya boolean asli True = admin.
    install_jwks()
    token = token_factory(sub="u", is_anonymous=False, is_admin=bad)
    resp = client.get("/admin/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


# ------------------------------- require_role (unit) ---------------------------------


def test_require_role_rejects_unknown_role():
    with pytest.raises(ValueError):
        require_role("editor")


def test_require_role_admin_passes_admin():
    dep = require_role("admin")
    user = AuthedUser(user_id="a", is_anonymous=False, is_admin=True)
    assert dep(user=user) is user


def test_require_role_admin_rejects_non_admin():
    dep = require_role("admin")
    user = AuthedUser(user_id="u", is_anonymous=False, is_admin=False)
    with pytest.raises(HTTPException) as exc:
        dep(user=user)
    assert exc.value.status_code == 403


def test_require_role_admin_rejects_anonymous_admin():
    dep = require_role("admin")
    user = AuthedUser(user_id="g", is_anonymous=True, is_admin=True)
    with pytest.raises(HTTPException) as exc:
        dep(user=user)
    assert exc.value.status_code == 403


# ----------------------------------- CORS -------------------------------------------


def test_cors_plural_overrides_and_strips():
    from api.server import _parse_cors_origins

    got = _parse_cors_origins({"CORS_ALLOW_ORIGINS": "http://a , http://b,"})
    assert got == ["http://a", "http://b"]


def test_cors_falls_back_to_singular():
    # Rename tak boleh merusak CORS prod game: singular lama tetap dihormati.
    from api.server import _parse_cors_origins

    assert _parse_cors_origins({"CORS_ALLOW_ORIGIN": "http://only"}) == ["http://only"]


def test_cors_default_includes_admin_origin():
    from api.server import _parse_cors_origins

    assert "http://localhost:5174" in _parse_cors_origins({})


def test_game_origin_still_allowed(client):
    # Regresi: origin game lama tetap diizinkan (CORS tak rusak oleh perubahan admin).
    resp = client.options(
        "/token",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"
