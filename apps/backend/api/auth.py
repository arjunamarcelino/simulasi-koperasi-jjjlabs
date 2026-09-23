"""Verifikasi JWT Supabase (SIM-4).

Dependency FastAPI `verify_supabase_jwt` memvalidasi access token Supabase (GoTrue)
SEBELUM `/token` mint token LiveKit. Backend tetap tanpa DB — token JWKS/ES256
self-verifying, tak perlu query Supabase.

Keputusan kunci (lihat docs/plans/2026-09-24-...-token-gating-supabase-jwt-plan.md):
- ES256 SAJA (algoritma di-pin; `alg` token TAK PERNAH dipilih dari header) →
  menutup celah alg-confusion (none / HS256-pakai-public-key / RS256).
- Cek `exp` (leeway kecil), `aud == authenticated`, `iss == proyek Supabase`,
  wajib `sub`.
- Guest (`is_anonymous: true`) BOLEH mint; token cuma menandainya. Parse ketat
  (`isinstance bool`); ambiguous/absen → guest (sisi restricted, fail-safe —
  selaras RLS Supabase `(auth.jwt()->>'is_anonymous')::boolean is false`).
- Role aplikasi (admin) DITUNDA ke SIM-14 — klaim `role` (selalu `authenticated`)
  BUKAN role otorisasi aplikasi.
- Kegagalan JWKS (jaringan) → 503 (bukan 401). `kid` tak dikenal → 401.
- Mitigasi H2 (DoS refetch JWKS): refetch paksa di-throttle + `kid` tak dikenal
  di-cache negatif, agar banjir token ber-`kid` acak tak memicu banjir fetch.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

# Muat .env DI SINI sebelum baca env level-modul. Modul ini di-import di puncak
# server.py — SEBELUM load_dotenv() milik server.py dijalankan — jadi ia harus
# memuat .env sendiri (pola sama dipakai voice_worker). Tanpa ini _jwks_client
# akan None dan setiap /token akan 500 padahal .env benar.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

log = logging.getLogger("koperasi.auth")

ALGORITHMS = ("ES256",)  # batas keamanan — hardcoded tuple, jangan dari token/config
LEEWAY = 10  # detik, margin clock-skew untuk exp/nbf
_REQUIRED_CLAIMS = ["exp", "aud", "iss", "sub"]

# Mitigasi H2 — throttle refetch JWKS.
_REFRESH_MIN_INTERVAL = 60.0  # detik: jarak minimum antar refetch paksa
_UNKNOWN_KID_TTL = 300.0  # detik: umur entri cache negatif kid tak dikenal
_UNKNOWN_KID_CAP = 2048  # batas ukuran cache negatif (anti memory-growth)

_JWKS_URL = os.environ.get("SUPABASE_JWKS_URL")
_ISSUER = os.environ.get("SUPABASE_JWT_ISSUER")
_AUD = os.environ.get("SUPABASE_JWT_AUD", "authenticated")

# Singleton level-modul. Konstruksi TIDAK fetch (fetch lazy saat resolusi kunci
# pertama). None bila belum dikonfigurasi → fail-closed di dependency.
_jwks_client: PyJWKClient | None = (
    PyJWKClient(_JWKS_URL, timeout=5, lifespan=300) if _JWKS_URL else None
)

_bearer = HTTPBearer(auto_error=False)  # hindari 403 bawaan; kita raise 401 sendiri

# State throttle JWKS (dibagi antar thread threadpool Starlette).
_jwks_lock = threading.Lock()
_unknown_kids: dict[str, float] = {}  # kid -> waktu kedaluwarsa (monotonic)
_last_forced_refresh = 0.0


@dataclass(frozen=True)
class AuthedUser:
    """Identitas terverifikasi dari JWT Supabase."""

    user_id: str  # klaim `sub` (dijamin non-kosong)
    is_anonymous: bool  # parse ketat; ambiguous/absen → True (guest, fail-safe)
    claims: dict[str, Any]  # klaim penuh — JANGAN di-log / di-stamp ke metadata LiveKit


def _unauthorized(detail: str = "invalid_token") -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _remember_unknown_kid(kid: str, now: float) -> None:
    """Catat `kid` tak dikenal di cache negatif (dipanggil di bawah _jwks_lock)."""
    if len(_unknown_kids) > _UNKNOWN_KID_CAP // 8:
        expired = [k for k, exp in _unknown_kids.items() if exp <= now]
        for k in expired:
            del _unknown_kids[k]
    if len(_unknown_kids) <= _UNKNOWN_KID_CAP:
        _unknown_kids[kid] = now + _UNKNOWN_KID_TTL


def _resolve_signing_key(token: str) -> jwt.PyJWK:
    """Ambil signing key ES256 untuk `token`, dengan throttle refetch (H2).

    Baca `kid` dari header BELUM terverifikasi (hanya untuk memilih kunci). Coba
    dari cache JWKS dulu; hanya paksa refetch bila `kid` tak dikenal DAN belum
    ada refetch paksa dalam _REFRESH_MIN_INTERVAL terakhir. `kid` yang tetap tak
    dikenal di-cache negatif → 401 tanpa jaringan pada request berikutnya.

    Raises:
        jwt.DecodeError: token malformed (→ 401 di pemanggil).
        HTTPException(401): `kid` hilang / tak dikenal.
        jwt.PyJWKClientConnectionError: JWKS tak terjangkau (→ 503 di pemanggil).
    """
    assert _jwks_client is not None  # dijamin oleh guard config di dependency
    header = jwt.get_unverified_header(token)  # DecodeError bila malformed
    kid = header.get("kid")
    if not kid:
        raise _unauthorized()

    now = time.monotonic()
    with _jwks_lock:
        exp = _unknown_kids.get(kid)
        if exp is not None and exp > now:
            raise _unauthorized("unknown_key")  # ditolak dari cache negatif, tanpa fetch

        key = PyJWKClient.match_kid(_jwks_client.get_signing_keys(refresh=False), kid)
        if key is not None:
            return key

        global _last_forced_refresh
        if now - _last_forced_refresh >= _REFRESH_MIN_INTERVAL:
            _last_forced_refresh = now  # hitung walau nanti gagal (cegah hammering)
            key = PyJWKClient.match_kid(
                _jwks_client.get_signing_keys(refresh=True), kid
            )
            if key is not None:
                return key

        _remember_unknown_kid(kid, now)
        raise _unauthorized("unknown_key")


def verify_supabase_jwt(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthedUser:
    """Dependency FastAPI: verifikasi JWT Supabase, kembalikan `AuthedUser`.

    401 = token hilang/invalid/kedaluwarsa/tak dikenal; 503 = JWKS tak terjangkau;
    500 = verifier belum dikonfigurasi (fail-closed).
    """
    if _jwks_client is None or not _ISSUER:  # config-first, fail-closed
        log.error("Konfigurasi verifikasi JWT Supabase belum lengkap")
        raise HTTPException(500, "Auth belum dikonfigurasi")
    if creds is None or not creds.credentials:  # HTTPBearer sudah filter skema non-Bearer → None
        raise _unauthorized("missing_bearer")
    token = creds.credentials

    try:
        signing_key = _resolve_signing_key(token)
    except jwt.PyJWKClientConnectionError as exc:  # jaringan/timeout → server fault
        log.warning("JWKS tidak terjangkau: %s", exc)
        raise HTTPException(503, "JWKS tidak tersedia") from exc
    except jwt.InvalidTokenError as exc:  # malformed saat baca kid → 401 (bukan 500)
        raise _unauthorized() from exc

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            audience=_AUD,
            issuer=_ISSUER,
            leeway=LEEWAY,
            options={"require": _REQUIRED_CLAIMS},
        )
    except jwt.InvalidTokenError as exc:  # exp/aud/iss/alg/sig/claim → semua 401
        raise _unauthorized() from exc

    sub = claims.get("sub")
    if not sub:  # `require` cek keberadaan, bukan kekosongan → jaga sub non-kosong
        raise _unauthorized()

    raw = claims.get("is_anonymous")
    # Parse KETAT: bool("false") == True di Python, jadi jangan pakai bool().
    # Hanya boolean asli yang dipercaya; sisanya → guest (sisi restricted/fail-safe).
    is_anonymous = raw if isinstance(raw, bool) else True

    return AuthedUser(user_id=sub, is_anonymous=is_anonymous, claims=claims)
