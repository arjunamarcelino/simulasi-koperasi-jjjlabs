"""FastAPI token server.

`POST /token` mint LiveKit access token dan meng-embed dispatch agent lewat
RoomConfiguration, sehingga worker (agent_name sama) otomatis bergabung ke room
baru dengan membawa `scenario_id` di job metadata (PRD §5).
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import uuid
from collections.abc import Mapping
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    model_validator,
)

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
    # DELETE ditambah untuk DELETE /admin/leaderboard/seasons/{id} (SIM-17).
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
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
    # Selalu TEPAT 5 bucket (0–20 … 81–100). Length di-enforce di model agar regresi band SQL
    # (4 atau 6 elemen) 500 keras, bukan lolos ke FE malformed (SIM-16 review).
    buckets: Annotated[list[int], Field(min_length=5, max_length=5)]


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


# --- Leaderboard XP musiman (SIM-17) ----------------------------------------------------
# Tiga route admin-gated di atas pool metrics_reader yang SAMA; capture/delete adalah WRITE
# lewat definer fn VOLATILE (blast radius METRICS_DB_URL meluas: baca → tulis admin-gated).
# season_id diketik `UUID` (query & path) → input salah-bentuk jadi 422 bersih di boundary
# FastAPI, BUKAN 503 menyesatkan; `UUID` di-bind native (tanpa cast `$1::uuid`).
class CaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")  # kunci asing → 422 (kontrak beku)
    # Label OPSIONAL: hilangkan field atau kirim null; non-empty 1..120 char (selaras CHECK di DB).
    # `min_length=1` menolak "" eksplisit (422) alih-alih diam-diam dikoersi; whitespace-only tetap
    # dikoersi ke NULL oleh `nullif(btrim(...),'')` di DB. Overlong → 422 sebelum sentuh DB.
    label: Annotated[str, Field(min_length=1, max_length=120)] | None = None


class LeaderboardEntry(BaseModel):
    rank: int
    display_name: str
    xp: int
    level: int


class SeasonHeader(BaseModel):
    id: str
    season_number: int
    label: str | None
    captured_at: str
    entry_count: int


class SelectedSeason(SeasonHeader):
    entries: list[LeaderboardEntry]


class LeaderboardOverviewResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")  # kontrak beku (model luar); sub-model tidak
    seasons: list[SeasonHeader]
    selected: SelectedSeason | None


class CaptureResultResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    season_id: str
    season_number: int
    captured_at: str
    entry_count: int


class DeleteResultResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deleted: bool
    season_number: int | None


@app.get("/admin/leaderboard", response_model=LeaderboardOverviewResponse)
async def leaderboard_overview(
    request: Request,
    # season_id OPSIONAL (query). Diketik UUID → salah-bentuk = 422 (boundary FastAPI) sebelum DB.
    season_id: UUID | None = None,
    # Gerbang admin SEBAGAI dependency → DB tak tersentuh sebelum 401/403 lolos (sama capture/delete).
    _admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        return await metrics_db.fetch_leaderboard_overview(
            request.app.state.metrics_pool, season_id
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None


@app.post("/admin/leaderboard/capture", response_model=CaptureResultResponse)
async def leaderboard_capture(
    req: CaptureRequest,
    request: Request,
    # Gerbang admin → DB tak tersentuh sebelum 401/403 lolos. Dinamai `admin` karena DIBACA
    # untuk atribusi log (user_id), bukan sekadar gerbang buang.
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        # Capture bersamaan serialize dengan MENUNGGU advisory-lock xact (bukan error); hanya jika
        # command_timeout habis saat menunggu → fail-soft 503 (BUKAN DB down). Lock auto-release saat
        # commit/rollback, jadi retry berhasil.
        result = await metrics_db.capture_leaderboard_snapshot(
            request.app.state.metrics_pool, req.label
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    # Atribusi server-side (captured_by TIDAK disimpan di DB): user_id + season_number, TANPA label.
    log.info(
        "Leaderboard snapshot captured by %s → musim #%s (%s peserta)",
        admin.user_id,
        result["season_number"],
        result["entry_count"],
    )
    return result


@app.delete("/admin/leaderboard/seasons/{season_id}", response_model=DeleteResultResponse)
async def leaderboard_delete_season(
    season_id: UUID,  # path diketik UUID → salah-bentuk = 422 bersih sebelum sentuh DB
    request: Request,
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        result = await metrics_db.delete_leaderboard_season(
            request.app.state.metrics_pool, season_id
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    # Musim tak ada → fn mengembalikan {deleted:false} (BUKAN raise, yang akan tertelan broad-except
    # jadi 503 menyesatkan). Peta eksplisit ke 404 di sini.
    if not result["deleted"]:
        raise HTTPException(404, "season_not_found")
    log.info(
        "Leaderboard season deleted by %s → musim #%s",
        admin.user_id,
        result["season_number"],
    )
    return result


# --- Quiz content management (SIM-18) ---------------------------------------------------
# Admin-gated CRUD over public.quiz_definition via the SAME metrics_reader pool. Error contract
# (load-bearing): metrics_db._call_definer turns any RAISE into a 503, so (a) input validation
# lives HERE in Pydantic → clean 422 at the boundary before the RPC, and (b) the admin fns return
# a structured {ok,reason} that we map to 404/409 — a raise would be a misleading 503. `code` is a
# PATH resource (404 on edit/delete-absent), mirroring the scenario-analytics convention.
class QuizQuestionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # kunci asing → 422 (kontrak beku)
    # `code` carries the natural key on CREATE (POST /admin/quiz); on EDIT it comes from the path
    # (POST /admin/quiz/{code}) and the body value is ignored — hence optional here.
    code: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    prompt: Annotated[str, Field(min_length=1)]
    # 2..4 options matches the 1..4 keyboard/LETTERS limit in the game's QuizBoard; each option is
    # non-empty (no blank choices).
    options: Annotated[list[Annotated[str, Field(min_length=1)]], Field(min_length=2, max_length=4)]
    correct_index: Annotated[int, Field(ge=0)]
    explanation: str | None = None
    sort_order: Annotated[int, Field(ge=0)] = 0
    # Compare-and-swap token: the `updated_at` string from GET /admin/quiz, echoed verbatim on EDIT.
    prev_updated_at: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> QuizQuestionBody:
        # Cross-field 422 before the RPC (the DB CHECK would otherwise raise → masked as 503).
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index out of range for options")
        if len(set(self.options)) != len(self.options):
            raise ValueError("options must be unique")
        return self


class QuizRow(BaseModel):
    code: str
    prompt: str
    options: list[str]
    correct_index: int
    explanation: str | None
    sort_order: int
    updated_at: str


class ListQuizResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")  # kontrak beku (model luar); sub-model (QuizRow) tidak
    ok: bool
    rows: list[QuizRow]


class DeleteQuizResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deleted: bool


# reason → HTTP status. Only the STATE reasons are enumerated (404/409); validation reasons are
# defense-in-depth (Pydantic rejects them first) and fall through to the 422 default — the same
# convention as _MADING_REASON_STATUS. An UNKNOWN ok:false reason must NEVER reach a 200.
_QUIZ_REASON_STATUS: dict[str, int] = {
    "not_found": 404,
    "has_completions": 409,
    "stale_write": 409,
    "duplicate_code": 409,
}


def _raise_for_quiz_reason(result: dict[str, Any]) -> None:
    reason = result.get("reason") or "conflict"
    raise HTTPException(_QUIZ_REASON_STATUS.get(reason, 422), reason)


@app.get("/admin/quiz", response_model=ListQuizResponse)
async def quiz_list(
    request: Request,
    _admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        return await metrics_db.list_quiz(request.app.state.metrics_pool)
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None


@app.post("/admin/quiz", response_model=QuizRow)
async def quiz_create(
    req: QuizQuestionBody,
    request: Request,
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    # CREATE: `code` is the client-supplied natural key (addressing matches mading's create route).
    if req.code is None or not req.code.strip():
        raise HTTPException(422, "code_required")
    try:
        result = await metrics_db.upsert_quiz_question(
            request.app.state.metrics_pool,
            code=req.code,
            prompt=req.prompt,
            options=req.options,
            correct_index=req.correct_index,
            explanation=req.explanation,
            sort_order=req.sort_order,
            prev_updated_at=None,
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    if not result.get("ok"):
        _raise_for_quiz_reason(result)
    log.info("Quiz question created by %s → %s", admin.user_id, req.code)
    return result["row"]


@app.post("/admin/quiz/{code}", response_model=QuizRow)
async def quiz_edit(
    code: str,
    req: QuizQuestionBody,
    request: Request,
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    # EDIT: `code` from the path (body code ignored); the CAS token is required (omitting it is a
    # 422, not a silent create/overwrite). Parse at the boundary → malformed timestamp = clean 422.
    if req.prev_updated_at is None:
        raise HTTPException(422, "prev_updated_at_required")
    try:
        prev = datetime.fromisoformat(req.prev_updated_at)
    except ValueError:
        raise HTTPException(422, "prev_updated_at_invalid") from None
    try:
        result = await metrics_db.upsert_quiz_question(
            request.app.state.metrics_pool,
            code=code,
            prompt=req.prompt,
            options=req.options,
            correct_index=req.correct_index,
            explanation=req.explanation,
            sort_order=req.sort_order,
            prev_updated_at=prev,
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    if not result.get("ok"):
        _raise_for_quiz_reason(result)
    log.info("Quiz question edited by %s → %s", admin.user_id, code)
    return result["row"]


@app.delete("/admin/quiz/{code}", response_model=DeleteQuizResponse)
async def quiz_delete(
    code: str,
    request: Request,
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        result = await metrics_db.delete_quiz_question(request.app.state.metrics_pool, code=code)
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    if not result.get("ok"):
        _raise_for_quiz_reason(result)
    log.info("Quiz question deleted by %s → %s", admin.user_id, code)
    return {"deleted": True}


# --- Mading content management (SIM-18) -------------------------------------------------
# Admin-gated CRUD over mading_block. Per-board payload validation is authoritative HERE in
# Pydantic (→ 422 at the boundary); the DB admin._mading_reject_reason is the defense-in-depth
# floor. extra="forbid" is set on EACH payload variant (not just the request wrapper) so a
# foreign key INSIDE the chosen payload is rejected. KnowledgeCard is a discriminated union.
class InfoPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, Field(min_length=1)]
    lines: Annotated[list[str], Field(min_length=1)]
    accent: Literal["mustard", "forest", "orange", "parchment"]


class DataPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, Field(min_length=1)]
    caption: str | None = None
    headers: Annotated[list[str], Field(min_length=1)]
    align: list[Literal["left", "right"]] | None = None
    rows: list[list[str]]

    @model_validator(mode="after")
    def _rectangular(self) -> DataPayload:
        n = len(self.headers)
        if self.align is not None and len(self.align) != n:
            raise ValueError("align length must equal headers length")
        if any(len(r) != n for r in self.rows):
            raise ValueError("every row length must equal headers length")
        return self


class StatCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["stat"]
    value: str
    label: str
    group: str | None = None
    sub: str | None = None


class FactCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["fact"]
    text: Annotated[str, Field(min_length=1)]
    chip: Literal["Prinsip Koperasi", "Landasan Hukum"] | None = None


_KnowledgeCard = Annotated[StatCard | FactCard, Field(discriminator="kind")]
_knowledge_adapter: TypeAdapter[StatCard | FactCard] = TypeAdapter(_KnowledgeCard)


class IdentitasPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nama: Annotated[str, Field(min_length=1)]
    badanHukum: Annotated[str, Field(min_length=1)]
    alamat: Annotated[str, Field(min_length=1)]
    desa: Annotated[str, Field(min_length=1)]


_BOARD_MODELS: dict[str, type[BaseModel]] = {
    "info": InfoPayload,
    "data": DataPayload,
    "identitas": IdentitasPayload,
}


class MadingUpsertBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    board: Literal["info", "data", "knowledge", "identitas"]
    block_key: str | None = None  # required for CREATE; ignored on EDIT (board/key immutable)
    payload: dict[str, Any]
    sort_order: Annotated[int, Field(ge=0)] = 0
    prev_updated_at: str | None = None  # None → CREATE; a value → compare-and-swap EDIT

    @model_validator(mode="after")
    def _validate_payload(self) -> MadingUpsertBody:
        # Dispatch the payload to its board model → a mis-shaped payload is a clean 422 before the RPC.
        try:
            if self.board == "knowledge":
                _knowledge_adapter.validate_python(self.payload)
            else:
                _BOARD_MODELS[self.board].model_validate(self.payload)
        except ValidationError as exc:
            raise ValueError(f"invalid {self.board} payload") from exc
        return self


class MadingRow(BaseModel):
    id: str
    board: str
    block_key: str
    payload: dict[str, Any]
    sort_order: int
    updated_at: str


class ListMadingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")  # outer contract; payloads inside groups stay Any
    ok: bool
    groups: dict[str, Any]


class DeleteMadingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deleted: bool


# State reasons map to 404/409; everything else (unknown_board / block_key_empty /
# sort_order_negative / payload reasons) is a validation failure → 422. Never fall through to 200.
_MADING_REASON_STATUS: dict[str, int] = {
    "not_found": 404,
    "stale_write": 409,
    "duplicate_key": 409,
    "identitas_exists": 409,
}


def _raise_for_mading_reason(result: dict[str, Any]) -> None:
    reason = result.get("reason") or "conflict"
    raise HTTPException(_MADING_REASON_STATUS.get(reason, 422), reason)


@app.get("/admin/mading", response_model=ListMadingResponse)
async def mading_list(
    request: Request,
    _admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        return await metrics_db.list_mading(request.app.state.metrics_pool)
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None


@app.post("/admin/mading", response_model=MadingRow)
async def mading_create(
    req: MadingUpsertBody,
    request: Request,
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    if req.block_key is None or not req.block_key.strip():
        raise HTTPException(422, "block_key_required")
    try:
        result = await metrics_db.upsert_mading_block(
            request.app.state.metrics_pool,
            block_id=None,
            board=req.board,
            block_key=req.block_key,
            payload=req.payload,
            sort_order=req.sort_order,
            prev_updated_at=None,
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    if not result.get("ok"):
        _raise_for_mading_reason(result)
    log.info("Mading block created by %s → %s/%s", admin.user_id, req.board, req.block_key)
    return result["row"]


@app.post("/admin/mading/{block_id}", response_model=MadingRow)
async def mading_edit(
    block_id: UUID,
    req: MadingUpsertBody,
    request: Request,
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    # Edit REQUIRES the CAS token (the updated_at from the loaded row) — omitting it is a 422, not a
    # silent overwrite. Parsed at the boundary so a malformed timestamp is a clean 422, not a 503.
    if req.prev_updated_at is None:
        raise HTTPException(422, "prev_updated_at_required")
    try:
        prev = datetime.fromisoformat(req.prev_updated_at)
    except ValueError:
        raise HTTPException(422, "prev_updated_at_invalid") from None
    try:
        # `board` here is ADVISORY on edit: it selects the Pydantic payload validator at the
        # boundary (best-effort pre-check), but the DB fn authoritatively re-validates the payload
        # against the STORED board (board is immutable on edit). A client sending a mismatched board
        # therefore gets a clean payload-reason 422 from the DB floor, never a wrong-shape write.
        result = await metrics_db.upsert_mading_block(
            request.app.state.metrics_pool,
            block_id=block_id,
            board=req.board,
            block_key=None,
            payload=req.payload,
            sort_order=req.sort_order,
            prev_updated_at=prev,
        )
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    if not result.get("ok"):
        _raise_for_mading_reason(result)
    log.info("Mading block edited by %s → %s", admin.user_id, block_id)
    return result["row"]


@app.delete("/admin/mading/{block_id}", response_model=DeleteMadingResponse)
async def mading_delete(
    block_id: UUID,
    request: Request,
    admin: AuthedUser = Depends(_require_admin),
) -> dict[str, Any]:
    try:
        result = await metrics_db.delete_mading_block(request.app.state.metrics_pool, block_id=block_id)
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    if not result.get("ok"):
        _raise_for_mading_reason(result)
    log.info("Mading block deleted by %s → %s", admin.user_id, block_id)
    return {"deleted": True}


# --- Reporting / export (SIM-19) --------------------------------------------------------
# GET /admin/reports/sessions.csv — the FIRST non-JSON response in the backend: a buffered text/csv
# download of COMPLETED sessions (no PII), optional ?from/?to date range on started_at. Data via
# admin.session_results_export($1,$2) through the SAME fail-soft metrics_reader pool (EXECUTE-only).
# All timestamp/number formatting is done IN SQL; Python only quotes, sanitizes, and concatenates.
_CSV_HEADER = [
    "session_id", "scenario_id", "scenario_title", "started_at", "ended_at",
    "duration_seconds", "trigger", "ending_type", "avg_score",
]
# CSV formula/DDE injection triggers (OWASP): a cell BEGINNING with one of these can execute in
# Excel/Sheets. Python's csv module does NOT guard this — we prefix a literal apostrophe ourselves.
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value: object) -> str:
    """Neutralize CSV formula injection on admin-authored free-text cells (scenario_id + title).

    Both come from scenario_definition.code/title (unconstrained text, editable via SIM-18 content
    mgmt), so both are untrusted here. UUID/ISO-timestamp/enum/number cells can't lead with a trigger
    char (avg_score is 0–100; duration_seconds is clamped >= 0 in SQL — so neither leads with '-'), so
    they're left alone by the callers. `s[:1]` (slice) is empty-string-safe (no IndexError)."""
    if value is None:
        return ""
    s = str(value)
    return "'" + s if s[:1] in _CSV_FORMULA_PREFIXES else s


def _build_sessions_csv(rows: list[dict[str, Any]]) -> bytes:
    """Render export rows to RFC-4180 CSV bytes (CRLF, minimal quoting, UTF-8 **with BOM** so Excel
    renders Indonesian titles correctly). io.StringIO does no newline translation → no newline="" needed."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(_CSV_HEADER)
    for r in rows:
        writer.writerow([
            r["session_id"],
            _csv_safe(r["scenario_id"]),
            _csv_safe(r["scenario_title"]),
            r["started_at"],
            r["ended_at"],
            r["duration_seconds"],
            r["trigger"],
            r["ending_type"],
            # null avg → empty cell; else the SQL round(…,1) value as an explicit string ("85.0").
            "" if r["avg_score"] is None else str(r["avg_score"]),
        ])
    return buf.getvalue().encode("utf-8-sig")


def _parse_date_param(raw: str | None, field: str) -> date | None:
    """Parse an optional ?from/?to query param as a strict YYYY-MM-DD date — the format CONTRACT.md
    documents. `strptime("%Y-%m-%d")` rejects time components AND the looser ISO forms
    `date.fromisoformat` would silently accept (basic `20261012`, ISO week `2026-W40-1`). A str param +
    manual parse yields a clean contract-shaped 422 {"detail":"<field>_invalid"} consistent with the
    SIM-18 prev_updated_at convention — NOT a validation-ordering fix (FastAPI resolves the admin
    dependency and raises its 401/403 before validating this operation's own params regardless of typing)."""
    if raw is None:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(422, f"{field}_invalid") from None


@app.get(
    "/admin/reports/sessions.csv",
    responses={200: {"content": {"text/csv": {}}}},  # honest OpenAPI for the file download
    response_class=Response,
)
async def export_sessions_csv(
    request: Request,
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    # Admin gate as a dependency → DB untouched before 401/403 lolos (same as the other admin routes).
    _admin: AuthedUser = Depends(_require_admin),
) -> Response:
    # Parse AFTER the gate; malformed date → 422 before any DB call. from > to needs no special case:
    # the half-open SQL predicate yields 0 rows → a 200 header-only CSV.
    p_from = _parse_date_param(date_from, "from")
    p_to = _parse_date_param(date_to, "to")
    try:
        rows = await metrics_db.fetch_session_export(request.app.state.metrics_pool, p_from, p_to)
    except MetricsUnavailable:
        raise HTTPException(503, "metrics_unavailable") from None
    body = _build_sessions_csv(rows)
    # Static ASCII prefix + UTC date, zero user input → no Content-Disposition header-injection surface.
    filename = f"koperasi-sessions-{datetime.now(UTC):%Y%m%d}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
