"""Test endpoint `POST /token` — perilaku route (bukan crypto verifier).

Detail mint diuji lewat dependency_overrides (inject user palsu); perilaku auth
(401/precedence) diuji lewat verifier ASLI + JWKS palsu (install_jwks).
"""

from __future__ import annotations

import json

import jwt

from api import server
from api.auth import AuthedUser, verify_supabase_jwt
from tests.conftest import LIVEKIT_TEST_SECRET


def _override_user(user: AuthedUser):
    server.app.dependency_overrides[verify_supabase_jwt] = lambda: user


def _decode_livekit(token: str) -> dict:
    return jwt.decode(
        token,
        LIVEKIT_TEST_SECRET,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )


# ------------------------- mint (override auth) --------------------------


def test_authenticated_mints_token_with_identity_and_metadata(client):
    _override_user(AuthedUser(user_id="user-abc", is_anonymous=False, claims={}))
    resp = client.post("/token", json={"scenario_id": "kredit-macet"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["room"].startswith("kredit-macet-")
    assert body["url"] == "wss://test.livekit.cloud"

    claims = _decode_livekit(body["token"])
    assert claims["sub"] == "user-abc"  # identity = Supabase sub
    meta = json.loads(claims["metadata"])
    assert meta == {"user_id": "user-abc", "is_anonymous": False}


def test_guest_is_marked_and_not_blocked(client):
    _override_user(AuthedUser(user_id="guest-9", is_anonymous=True, claims={}))
    resp = client.post("/token", json={"scenario_id": "tutorial-koperasi-konsumen"})
    assert resp.status_code == 200
    meta = json.loads(_decode_livekit(resp.json()["token"])["metadata"])
    assert meta["is_anonymous"] is True


def test_livekit_token_has_no_pii_claims(client):
    # Metadata peserta hanya user_id + is_anonymous; klaim JWT penuh tak bocor.
    _override_user(
        AuthedUser(
            user_id="user-x",
            is_anonymous=False,
            claims={"email": "secret@example.com", "phone": "+62..."},
        )
    )
    resp = client.post("/token", json={"scenario_id": "kredit-macet"})
    meta = json.loads(_decode_livekit(resp.json()["token"])["metadata"])
    assert "email" not in meta and "phone" not in meta


def test_unknown_scenario_is_422(client):
    _override_user(AuthedUser(user_id="u", is_anonymous=False, claims={}))
    resp = client.post("/token", json={"scenario_id": "tidak-ada"})
    assert resp.status_code == 422


def test_missing_scenario_field_is_422(client):
    _override_user(AuthedUser(user_id="u", is_anonymous=False, claims={}))
    resp = client.post("/token", json={})
    assert resp.status_code == 422


def test_livekit_unconfigured_is_500(client, monkeypatch):
    monkeypatch.setattr(server, "LIVEKIT_API_KEY", "")
    _override_user(AuthedUser(user_id="u", is_anonymous=False, claims={}))
    resp = client.post("/token", json={"scenario_id": "kredit-macet"})
    assert resp.status_code == 500


# ------------------- auth behavior (verifier ASLI) -----------------------


def test_no_token_is_401(client, install_jwks):
    install_jwks()
    resp = client.post("/token", json={"scenario_id": "kredit-macet"})
    assert resp.status_code == 401
    assert resp.headers.get("www-authenticate") == "Bearer"


def test_auth_precedes_scenario_validation(client, install_jwks):
    # Tanpa token + scenario invalid → 401 (auth dulu), BUKAN 422 (bocor input).
    install_jwks()
    resp = client.post("/token", json={"scenario_id": "tidak-ada"})
    assert resp.status_code == 401


def test_valid_token_end_to_end(client, install_jwks, token_factory):
    # Full stack: verifier ASLI (JWKS palsu) → mint. Tanpa override.
    install_jwks()
    token = token_factory(sub="e2e-user", is_anonymous=False)
    resp = client.post(
        "/token",
        json={"scenario_id": "rapat-anggota-tahunan"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert _decode_livekit(resp.json()["token"])["sub"] == "e2e-user"


def test_expired_token_end_to_end_is_401(client, install_jwks, token_factory):
    install_jwks()
    token = token_factory(exp_delta=-3600)
    resp = client.post(
        "/token",
        json={"scenario_id": "kredit-macet"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401


def test_health_is_unauthenticated(client):
    assert client.get("/health").status_code == 200


# --------------------------- CORS / protocol -----------------------------


def test_preflight_allows_authorization_header(client):
    resp = client.options(
        "/token",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 200
    assert "authorization" in resp.headers["access-control-allow-headers"].lower()


def test_401_carries_cors_header(client, install_jwks):
    # Tanpa header CORS di response 401, browser menyembunyikan status →
    # refresh-retry authedFetch tak pernah jalan. Regresi paling bernilai.
    install_jwks()
    resp = client.post(
        "/token",
        json={"scenario_id": "kredit-macet"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert resp.status_code == 401
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"
