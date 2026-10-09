"""FastAPI token server.

`POST /token` mint LiveKit access token dan meng-embed dispatch agent lewat
RoomConfiguration, sehingga worker (agent_name sama) otomatis bergabung ke room
baru dengan membawa `scenario_id` di job metadata (PRD §5).
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from collections.abc import Mapping
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from pydantic import BaseModel, ConfigDict

from . import auth, metrics_db
from .auth import AuthedUser, require_role, verify_supabase_jwt
from .metrics_db import MetricsUnavailable
from .ratelimit import RateLimiter

log = logging.getLogger("koperasi.token")

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "koperasi-agent")

CORS_DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:5174"  # dev: game + admin


def _parse_cors_origins(env: Mapping[str, str] | None = None) -> list[str]:
    """Daftar origin CORS. Prioritas: CORS_ALLOW_ORIGINS (comma-split) → fallback ke
    CORS_ALLOW_ORIGIN lama (agar CORS prod game tak diam-diam rusak saat rename) →
    default dev game+admin. Strip spasi & buang entri kosong. Jika sebuah sumber hanya
    berisi spasi/koma (→ kosong setelah filter), JATUH ke sumber berikutnya alih-alih
    memblokir semua origin diam-diam."""
    e = os.environ if env is None else env
    for raw in (e.get("CORS_ALLOW_ORIGINS"), e.get("CORS_ALLOW_ORIGIN"), CORS_DEFAULT_ORIGINS):
        origins = [o.strip() for o in (raw or "").split(",") if o.strip()]
        if origins:
            return origins
    return []


CORS_ALLOW_ORIGINS = _parse_cors_origins()

# Rate limit per-user pada /token (mitigasi H1: tiap mint men-dispatch agent
# berbayar). Default: TOKEN_RATE_CAPACITY permintaan per TOKEN_RATE_WINDOW_SEC.
TOKEN_RATE_CAPACITY = int(os.environ.get("TOKEN_RATE_CAPACITY", "10"))
TOKEN_RATE_WINDOW_SEC = float(os.environ.get("TOKEN_RATE_WINDOW_SEC", "60"))
_TOKEN_LIMITER = RateLimiter(TOKEN_RATE_CAPACITY, TOKEN_RATE_WINDOW_SEC)

# scenario_id valid (mirror CONTRACT.md §1). Divalidasi SETELAH auth → 422.
VALID_SCENARIOS = frozenset(
    {
        "tutorial-koperasi-konsumen",
        "kredit-macet",
        "keanggotaan-fiktif",
        "rapat-anggota-tahunan",
    }
)
# Token LiveKit berumur pendek (selaras satu sesi), bukan default 6 jam.
LIVEKIT_TOKEN_TTL = timedelta(hours=1)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail-soft: create_pool() returns None (never raises) if the metrics DB is
    # unset/unreachable/slow, so /token + /health still come up (SIM-15).
    app.state.metrics_pool = await metrics_db.create_pool()
    try:
        yield
    finally:
        if app.state.metrics_pool is not None:
            await app.state.metrics_pool.close()


app = FastAPI(title="Koperasi Token Server", lifespan=lifespan)
# Module-scope default so a bare TestClient(app) (lifespan not run) sees None → 503, not
# AttributeError → 500.
app.state.metrics_pool = None

# CORS eksplisit (bukan wildcard): FE mengirim header `Authorization` (Bearer), jadi
# request /token dan GET /admin/me menjadi preflighted. `allow_origins` di sini BUKAN
# kontrol auth — JWT-lah gerbangnya. Tanpa credentials (Bearer di header, bukan cookie).
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class TokenRequest(BaseModel):
    scenario_id: str


class TokenResponse(BaseModel):
    token: str
    room: str
    url: str


class AdminMeResponse(BaseModel):
    user_id: str


# Singleton level-modul (bukan call di argumen default → hindari B008, dan validasi
# role 'admin' sekali saat import, bukan tiap request).
_require_admin = require_role("admin")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/admin/me", response_model=AdminMeResponse)
def admin_me(user: AuthedUser = Depends(_require_admin)) -> AdminMeResponse:
    # Probe gerbang admin (SIM-14). require_role sudah menjamin admin & non-anon:
    # token hilang/invalid → 401 (verifier), authenticated non-admin/anon → 403.
    # Body cuma user_id (tampilan) — OTORISASI ada di KODE STATUS, bukan body (200 =
    # admin). Sengaja TANPA is_admin agar tak jadi jebakan "gate on body".
    return AdminMeResponse(user_id=user.user_id)


# --- GET /admin/metrics (SIM-15) --------------------------------------------------------
# Typed sub-models so response_model benar-benar memvalidasi output SQL + jadi kontrak
# OpenAPI nyata (bukan `dict` + extra="allow" yang tak memvalidasi apa pun). Rate & avg
# bernilai number ATAU null (number|null), count selalu int. `null` = tak terdefinisi.
class EndingSplit(BaseModel):
    good: float
    neutral: float
    bad: float


class UsersMetrics(BaseModel):
    active_30d: int
    total_registered: int
    new_7d: int


class SessionsMetrics(BaseModel):
    total: int
    completion_rate: float | None
    ending_split: EndingSplit | None
    avg_score: float | None


class ScenarioRow(BaseModel):
    scenario_id: str
    title: str
    sessions: int
    completion_rate: float | None
    ending_split: EndingSplit | None
    avg_score: float | None


class AdminMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")  # kontrak beku → tolak kunci SQL tak terduga
    generated_at: str
    users: UsersMetrics
    sessions: SessionsMetrics
    per_scenario: list[ScenarioRow]


async def get_metrics(
    request: Request,
    # Gerbang admin SEBAGAI dependency struktural → DB tak tersentuh sebelum 401/403 lolos
    # (tak bergantung urutan argumen). pytest mem-patch metrics_db.fetch_metrics / pool.
    _admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        return await metrics_db.fetch_metrics(request.app.state.metrics_pool)
    except MetricsUnavailable:
        # DB mati/salah-konfig/lambat → 503 (fail-soft), JANGAN 500. Game tak terpengaruh.
        raise HTTPException(503, "metrics_unavailable") from None


@app.get("/admin/metrics", response_model=AdminMetricsResponse)
async def admin_metrics(data: dict[str, Any] = Depends(get_metrics)) -> dict[str, Any]:
    return data  # get_metrics sudah admin-gated; FastAPI memvalidasi `data` ke model


# --- GET /admin/scenarios/{scenario_id}/analytics (SIM-16) ------------------------------
# Drill-down per-skenario. Endpoint + model TERPISAH dari /admin/metrics (kontrak beku itu tak
# disentuh). `outcome` pakai COUNT (bukan rate). `by_trigger` = dict TERBUKA → nilai trigger baru
# tak pernah merusak kontrak (tak di-`extra="forbid"` satu lapis lebih dalam). `dropoff` selalu
# null di Core (modul event-log = tiket lanjutan). extra="forbid" HANYA di model luar (seperti
# AdminMetricsResponse; sub-model-nya pun tak menyetelnya).
class EndingCounts(BaseModel):
    good: int
    neutral: int
    bad: int


class OutcomeBreakdown(BaseModel):
    completed: int
    bubar: int
    by_trigger: dict[str, int]
    ending_counts: EndingCounts


class PillarDist(BaseModel):
    key: str
    count: int
    avg: float | None
    buckets: list[int]


class ScenarioAnalyticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")  # kontrak beku (model luar); sub-model tidak
    scenario_id: str
    title: str
    generated_at: str
    attempts: int
    outcome: OutcomeBreakdown
    avg_score: float | None
    pillars: list[PillarDist]
    # Selalu null di Core. Bentuk drop-off step-level didefinisikan saat modul event-log menyusul
    # (tiket lanjutan) — JANGAN menebak shape-nya di sini lebih dulu (hindari drift kontrak).
    dropoff: None


async def get_scenario_analytics(
    scenario_id: str,
    request: Request,
    # Gerbang admin SEBAGAI dependency → DB tak tersentuh sebelum 401/403 lolos (sama get_metrics).
    _admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    # scenario_id divalidasi SETELAH auth (non-admin → 403 dulu), SEBELUM sentuh DB. Resource di
    # PATH → 404 (beda /token yang 422 untuk field di body). Membedakan "skenario valid 0 sesi"
    # (200, attempts:0) dari "skenario tak dikenal" (404) — inti UX endpoint ini.
    if scenario_id not in VALID_SCENARIOS:
        raise HTTPException(404, "unknown_scenario")
    try:
        return await metrics_db.fetch_scenario_analytics(
            request.app.state.metrics_pool, scenario_id
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None


@app.get(
    "/admin/scenarios/{scenario_id}/analytics",
    response_model=ScenarioAnalyticsResponse,
)
async def scenario_analytics(
    data: dict[str, Any] = Depends(get_scenario_analytics),
) -> dict[str, Any]:
    return data  # sudah admin-gated + validasi scenario_id; FastAPI memvalidasi `data` ke model


@app.post("/token", response_model=TokenResponse)
def create_token(
    req: TokenRequest,
    user: AuthedUser = Depends(verify_supabase_jwt),
) -> TokenResponse:
    # Validasi scenario_id dulu (murah, in-memory) SEBELUM konsumsi token rate-limit,
    # agar input malformed tak menghabiskan kuota user. Tetap SETELAH auth (dependency
    # sudah jalan) → caller tak-terautentikasi dapat 401 lebih dulu, bukan 422.
    if req.scenario_id not in VALID_SCENARIOS:
        raise HTTPException(422, "scenario_id tidak dikenal")
    # Rate limit per-user (setelah auth). Flood tanpa auth sudah 401 lebih dulu.
    retry_after = _TOKEN_LIMITER.check(user.user_id)
    if retry_after > 0:
        raise HTTPException(
            429,
            "Terlalu banyak permintaan token",
            headers={"Retry-After": str(int(retry_after) + 1)},
        )
    if not (LIVEKIT_API_KEY and LIVEKIT_API_SECRET and LIVEKIT_URL):
        raise HTTPException(500, "Kredensial LiveKit belum dikonfigurasi di .env")

    room = f"{req.scenario_id}-{uuid.uuid4().hex[:8]}"

    token = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        # Identitas peserta = Supabase sub (dulu player-<uuid8> acak) → sesi bisa
        # diatribusikan ke user server-side. Metadata peserta (tepercaya, dari JWT
        # terverifikasi) memakai AuthedUser.participant_metadata() — definisi tunggal
        # bentuk wire server→worker (hanya user_id + is_anonymous, non-PII).
        .with_identity(user.user_id)
        .with_name("Petugas")
        .with_ttl(LIVEKIT_TOKEN_TTL)
        .with_metadata(json.dumps(user.participant_metadata()))
        .with_grants(api.VideoGrants(room_join=True, room=room))
        .with_room_config(
            api.RoomConfiguration(
                agents=[
                    api.RoomAgentDispatch(
                        agent_name=AGENT_NAME,
                        metadata=json.dumps({"scenario_id": req.scenario_id}),
                    )
                ],
            )
        )
        .to_jwt()
    )

    return TokenResponse(token=token, room=room, url=LIVEKIT_URL)


def _log_config_readiness() -> None:
    """Peringatkan saat start jika config tak lengkap — agar deploy salah-konfigurasi
    terlihat di log SEBELUM user pertama kena 500 (bukan hanya per-request)."""
    if not auth.is_configured():
        log.warning(
            "Verifikasi JWT Supabase BELUM dikonfigurasi "
            "(SUPABASE_JWKS_URL / SUPABASE_JWT_ISSUER) — /token akan 500 sampai di-set."
        )
    if not (LIVEKIT_API_KEY and LIVEKIT_API_SECRET and LIVEKIT_URL):
        log.warning("Kredensial LiveKit belum lengkap — /token akan 500.")
    if not os.environ.get("METRICS_DB_URL"):
        log.warning("METRICS_DB_URL belum di-set — GET /admin/metrics akan 503 (fail-soft).")


_log_config_readiness()
