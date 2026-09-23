"""Unit test `verify_supabase_jwt` — memanggil verifier ASLI (bukan override).

Cakupan: positif (auth/guest/leeway/resolve-dari-cache), negatif (semua → 401),
edge/infra (503, 500, parse is_anonymous ketat, kid tak dikenal tanpa refetch),
dan guard konfigurasi `_build_client`.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from api import auth
from tests.conftest import AUD, ISSUER, TEST_KID


def _bearer(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _call(token: str) -> auth.AuthedUser:
    return auth.verify_supabase_jwt(creds=_bearer(token))


# ----------------------------- POSITIF -----------------------------------


def test_valid_authenticated_token(install_jwks, token_factory):
    install_jwks()
    user = _call(token_factory(sub="user-123", is_anonymous=False))
    assert user.user_id == "user-123"
    assert user.is_anonymous is False


def test_valid_guest_token(install_jwks, token_factory):
    install_jwks()
    user = _call(token_factory(sub="guest-1", is_anonymous=True))
    assert user.is_anonymous is True


def test_within_exp_leeway_accepted(install_jwks, token_factory):
    install_jwks()
    # exp 5 dtk lalu, di dalam LEEWAY (10 dtk) → tetap diterima
    user = _call(token_factory(exp_delta=-5))
    assert user.user_id == "user-123"


def test_key_resolved_from_cache_without_refetch(install_jwks, token_factory):
    # Happy path: kid ada di JWK set ter-cache → resolve tanpa force-refetch.
    client = install_jwks()
    user = _call(token_factory())
    assert user.user_id == "user-123"
    assert client.refresh_calls == 0  # tak pernah force-refetch


# ----------------------------- NEGATIF (→ 401) ---------------------------


def _assert_401(token: str) -> None:
    with pytest.raises(HTTPException) as exc:
        _call(token)
    assert exc.value.status_code == 401
    assert exc.value.headers.get("WWW-Authenticate") == "Bearer"


def test_missing_bearer_is_401(install_jwks):
    install_jwks()
    with pytest.raises(HTTPException) as exc:
        auth.verify_supabase_jwt(creds=None)
    assert exc.value.status_code == 401


def test_malformed_token_is_401_not_500(install_jwks):
    # BUG-1 guard: DecodeError terjadi DI DALAM baca kid → harus 401, bukan 500.
    install_jwks()
    _assert_401("not-a-jwt")
    _assert_401("garbage.garbage.garbage")


def test_bad_signature_is_401(install_jwks, token_factory, other_keypair):
    install_jwks()  # JWKS sajikan kunci utama; token ditandatangani kunci LAIN
    _assert_401(token_factory(signing_pem=other_keypair.private_pem))


def test_alg_none_is_401(install_jwks, token_factory):
    install_jwks()
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "none", "kid": TEST_KID}).encode()
    ).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "x", "aud": AUD, "iss": ISSUER, "exp": int(time.time()) + 60}).encode()
    ).rstrip(b"=").decode()
    _assert_401(f"{header}.{payload}.")


def test_alg_hs256_signed_with_public_key_is_401(install_jwks, keypair):
    # Serangan alg-confusion nyata: attacker tanda tangani HS256 memakai PUBLIC key
    # (yang tak rahasia) sebagai secret HMAC. Dibuat manual karena PyJWT menolak
    # encode HS256 dengan kunci PEM. Verifier kita HARUS menolak (alg di-pin ES256).
    install_jwks()
    pub_pem = keypair.public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    def _seg(obj) -> bytes:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=")

    now = int(time.time())
    signing_input = (
        _seg({"alg": "HS256", "typ": "JWT", "kid": TEST_KID})
        + b"."
        + _seg({"sub": "x", "aud": AUD, "iss": ISSUER, "exp": now + 60})
    )
    sig = base64.urlsafe_b64encode(
        hmac.new(pub_pem, signing_input, hashlib.sha256).digest()
    ).rstrip(b"=")
    forged = (signing_input + b"." + sig).decode()
    _assert_401(forged)


def test_expired_beyond_leeway_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(exp_delta=-3600))


def test_nbf_future_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(nbf_delta=3600))


def test_wrong_aud_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(aud="anon"))


def test_wrong_iss_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(iss="https://evil.supabase.co/auth/v1"))


def test_missing_sub_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(drop=("sub",)))


def test_empty_sub_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(sub=""))


def test_missing_exp_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(drop=("exp",)))


# ----------------------------- EDGE / INFRA ------------------------------


def test_jwks_unreachable_is_503(install_jwks, token_factory):
    install_jwks(fail=True)
    with pytest.raises(HTTPException) as exc:
        _call(token_factory())
    assert exc.value.status_code == 503


def test_aud_as_array_accepted(install_jwks, token_factory):
    install_jwks()
    user = _call(token_factory(aud=["authenticated", "other"]))
    assert user.user_id == "user-123"


@pytest.mark.parametrize(
    "raw,expected",
    [
        (True, True),
        (False, False),
        ("true", True),   # string → guest (fail-safe), BUKAN bool("true")
        ("false", True),  # string → guest; bool("false") juga True, tapi kita fail-safe
        (None, True),     # absen/null → guest
        (1, True),
    ],
)
def test_is_anonymous_strict_parse(install_jwks, token_factory, raw, expected):
    install_jwks()
    kwargs = {} if raw is None else {"is_anonymous": raw}
    user = _call(token_factory(**kwargs))
    assert user.is_anonymous is expected


def test_unknown_kid_is_401_without_refetch(install_jwks, keypair):
    # Banjir token ber-kid acak yang tak dikenal → semua 401, TANPA force-refetch
    # (H2: rotasi diambil via cache lifespan, bukan refetch on-miss). refresh=0.
    client = install_jwks()  # hanya punya TEST_KID
    now = int(time.time())

    def mint_unknown(kid: str) -> str:
        return jwt.encode(
            {"sub": "x", "aud": AUD, "iss": ISSUER, "exp": now + 60},
            keypair.private_pem,
            algorithm="ES256",
            headers={"kid": kid},
        )

    for i in range(20):
        with pytest.raises(HTTPException) as exc:
            _call(mint_unknown(f"random-kid-{i}"))
        assert exc.value.status_code == 401
    assert client.refresh_calls == 0  # tak pernah force-refetch pada kid tak dikenal


def test_empty_kid_header_is_401(install_jwks, token_factory):
    install_jwks()
    _assert_401(token_factory(kid=""))


def test_config_missing_is_500(monkeypatch, token_factory):
    # Fail-closed: verifier belum dikonfigurasi → 500 (jangan skip verifikasi).
    monkeypatch.setattr(auth, "_jwks_client", None)
    monkeypatch.setattr(auth, "_ISSUER", None)
    with pytest.raises(HTTPException) as exc:
        _call(token_factory())
    assert exc.value.status_code == 500


def test_build_client_from_env():
    # Guard config: _build_client membangun client saat SUPABASE_JWKS_URL ada,
    # dan None saat tak ada. Diuji langsung dengan dict — tanpa reload modul.
    client = auth._build_client(
        {"SUPABASE_JWKS_URL": "https://x.supabase.co/auth/v1/.well-known/jwks.json"}
    )
    assert client is not None
    assert auth._build_client({}) is None
