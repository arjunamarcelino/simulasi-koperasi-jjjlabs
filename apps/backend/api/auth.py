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
- Resolusi kunci memakai cache JWKS bawaan PyJWKClient (`lifespan=300`); TIDAK ada
  force-refetch pada `kid` tak dikenal (rotasi diambil saat cache kedaluwarsa,
  <=300 dtk). Ini menghindari (a) DoS refetch JWKS oleh banjir `kid` acak dan
  (b) serialisasi seluruh verifikasi di balik satu lock global.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

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
_REQUIRED_CLAIMS = ("exp", "aud", "iss", "sub")


def _build_client(env: Mapping[str, str]) -> PyJWKClient | None:
    """Bangun PyJWKClient dari konfigurasi env (None bila belum dikonfigurasi).

    Dipisah agar bisa diuji langsung dengan dict — tanpa reload modul.
    """
    url = env.get("SUPABASE_JWKS_URL")
    # timeout pendek: fetch JWKS hanya saat cold-start / cache lifespan (300s) habis.
    return PyJWKClient(url, timeout=5, lifespan=300) if url else None


_jwks_client = _build_client(os.environ)
_ISSUER = os.environ.get("SUPABASE_JWT_ISSUER")
_AUD = os.environ.get("SUPABASE_JWT_AUD", "authenticated")

_bearer = HTTPBearer(auto_error=False)  # hindari 403 bawaan; kita raise 401 sendiri


@dataclass(frozen=True)
class AuthedUser:
    """Identitas terverifikasi dari JWT Supabase.

    Sengaja MINIMAL — hanya field yang dipakai downstream. Klaim penuh (yang bisa
    memuat email/phone) TIDAK disimpan di objek ini agar tak mungkin bocor ke log
    atau metadata LiveKit. Saat SIM-14 butuh role, hitung `is_admin: bool` di sini
    saat verifikasi, jangan bawa klaim mentah.
    """

    user_id: str  # klaim `sub` (dijamin non-kosong)
    is_anonymous: bool  # parse ketat; ambiguous/absen → True (guest, fail-safe)


def _unauthorized(detail: str = "invalid_token") -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _resolve_signing_key(client: PyJWKClient, token: str) -> jwt.PyJWK:
    """Ambil signing key ES256 untuk `token` dari cache JWKS (tanpa force-refetch).

    Baca `kid` dari header BELUM terverifikasi (hanya untuk memilih kunci), lalu
    cocokkan ke JWK set ter-cache PyJWKClient. `kid` tak dikenal → 401 (bukan
    memaksa fetch jaringan). Rotasi kunci diambil saat cache `lifespan` habis.

    Raises:
        jwt.DecodeError: token malformed (→ 401 di pemanggil).
        HTTPException(401): `kid` hilang / tak dikenal.
        jwt.PyJWKClientConnectionError: JWKS tak terjangkau saat cache dingin
            (→ 503 di pemanggil).
    """
    header = jwt.get_unverified_header(token)  # DecodeError bila malformed
    kid = header.get("kid")
    if not kid:
        raise _unauthorized()
    key = PyJWKClient.match_kid(client.get_signing_keys(refresh=False), kid)
    if key is None:
        raise _unauthorized("unknown_key")
    return key


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
        signing_key = _resolve_signing_key(_jwks_client, token)
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
            options={"require": list(_REQUIRED_CLAIMS)},
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

    return AuthedUser(user_id=sub, is_anonymous=is_anonymous)
