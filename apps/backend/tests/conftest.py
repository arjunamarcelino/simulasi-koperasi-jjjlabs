"""Fixtures bersama untuk test SIM-4.

Semua test memakai kunci ES256 yang dibangkitkan lokal + JWKS palsu, sehingga
tak butuh jaringan / proyek Supabase nyata.
"""

from __future__ import annotations

import base64
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

TEST_KID = "test-key-1"
ISSUER = "https://test.supabase.co/auth/v1"
AUD = "authenticated"


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _jwk_from_public(public_key: ec.EllipticCurvePublicKey, kid: str) -> jwt.PyJWK:
    nums = public_key.public_numbers()
    return jwt.PyJWK.from_dict(
        {
            "kty": "EC",
            "crv": "P-256",
            "alg": "ES256",
            "use": "sig",
            "kid": kid,
            "x": _b64u(nums.x.to_bytes(32, "big")),
            "y": _b64u(nums.y.to_bytes(32, "big")),
        }
    )


@dataclass
class KeyMaterial:
    kid: str
    private_pem: bytes
    public_key: ec.EllipticCurvePublicKey
    jwk: jwt.PyJWK


def _make_key(kid: str) -> KeyMaterial:
    priv = ec.generate_private_key(ec.SECP256R1())  # P-256 == ES256
    priv_pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    pub = priv.public_key()
    return KeyMaterial(kid, priv_pem, pub, _jwk_from_public(pub, kid))


@pytest.fixture(scope="session")
def keypair() -> KeyMaterial:
    """Kunci ES256 utama (kid=TEST_KID) yang JWKS palsu akan sajikan."""
    return _make_key(TEST_KID)


@pytest.fixture(scope="session")
def other_keypair() -> KeyMaterial:
    """Kunci ES256 kedua (kid berbeda) untuk kasus tanda tangan salah / rotasi."""
    return _make_key("other-key-2")


@pytest.fixture
def token_factory(keypair: KeyMaterial) -> Callable[..., str]:
    """Cetak JWT untuk pengujian; override klaim/kunci/alg via kwargs."""

    def _mint(
        *,
        sub: str | None = "user-123",
        aud: Any = AUD,
        iss: str | None = ISSUER,
        exp_delta: int = 3600,
        nbf_delta: int | None = None,
        kid: str = TEST_KID,
        alg: str = "ES256",
        signing_pem: bytes | None = None,
        drop: tuple[str, ...] = (),
        **extra: Any,
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {"iat": now, "exp": now + exp_delta}
        if sub is not None:
            claims["sub"] = sub
        if aud is not None:
            claims["aud"] = aud
        if iss is not None:
            claims["iss"] = iss
        if nbf_delta is not None:
            claims["nbf"] = now + nbf_delta
        claims.update(extra)
        for key in drop:
            claims.pop(key, None)
        return jwt.encode(
            claims,
            signing_pem if signing_pem is not None else keypair.private_pem,
            algorithm=alg,
            headers={"kid": kid},
        )

    return _mint


class FakeJWKClient:
    """Pengganti PyJWKClient: menyajikan kunci in-memory, menghitung refetch paksa."""

    def __init__(self, keys: list[jwt.PyJWK], fail: bool = False) -> None:
        self._keys = keys
        self.fail = fail
        self.refresh_calls = 0  # jumlah get_signing_keys(refresh=True) = fetch jaringan nyata

    def get_signing_keys(self, refresh: bool = False) -> list[jwt.PyJWK]:
        if refresh:
            self.refresh_calls += 1
        if self.fail:
            raise jwt.PyJWKClientConnectionError("JWKS unreachable (test)")
        return list(self._keys)


@pytest.fixture
def install_jwks(monkeypatch, keypair: KeyMaterial):
    """Pasang JWKS palsu + config verifier; reset state throttle antar test."""
    from api import auth

    def _install(*, keys: list[jwt.PyJWK] | None = None, fail: bool = False) -> FakeJWKClient:
        key_list = [keypair.jwk] if keys is None else keys
        client = FakeJWKClient(key_list, fail=fail)
        monkeypatch.setattr(auth, "_jwks_client", client)
        monkeypatch.setattr(auth, "_ISSUER", ISSUER)
        monkeypatch.setattr(auth, "_AUD", AUD)
        return client

    return _install


# Secret LiveKit dummy untuk test (≥32 char agar tak memicu peringatan kunci pendek).
LIVEKIT_TEST_SECRET = "test-livekit-secret-0123456789abcdef"


@pytest.fixture
def client(monkeypatch):
    """TestClient dengan kredensial LiveKit dummy; bersihkan override setelahnya."""
    from fastapi.testclient import TestClient

    from api import server
    from api.ratelimit import RateLimiter

    monkeypatch.setattr(server, "LIVEKIT_API_KEY", "devkey")
    monkeypatch.setattr(server, "LIVEKIT_API_SECRET", LIVEKIT_TEST_SECRET)
    monkeypatch.setattr(server, "LIVEKIT_URL", "wss://test.livekit.cloud")
    # Limiter segar per test (hindari akumulasi lintas test); default longgar.
    monkeypatch.setattr(server, "_TOKEN_LIMITER", RateLimiter(100, 60))
    with TestClient(server.app) as test_client:
        yield test_client
    server.app.dependency_overrides.clear()
