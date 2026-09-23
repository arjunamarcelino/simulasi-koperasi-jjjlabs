"""FastAPI token server.

`POST /token` mint LiveKit access token dan meng-embed dispatch agent lewat
RoomConfiguration, sehingga worker (agent_name sama) otomatis bergabung ke room
baru dengan membawa `scenario_id` di job metadata (PRD §5).
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from pydantic import BaseModel

from .auth import AuthedUser, verify_supabase_jwt

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "koperasi-agent")
CORS_ALLOW_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "http://localhost:5173")

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

app = FastAPI(title="Koperasi Token Server")

# CORS eksplisit (bukan wildcard): FE mengirim header `Authorization` (Bearer),
# jadi request /token menjadi preflighted. `allow_origins` di sini BUKAN kontrol
# auth — JWT-lah gerbangnya. Tanpa credentials (Bearer di header, bukan cookie).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ALLOW_ORIGIN],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class TokenRequest(BaseModel):
    scenario_id: str


class TokenResponse(BaseModel):
    token: str
    room: str
    url: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/token", response_model=TokenResponse)
def create_token(
    req: TokenRequest,
    user: AuthedUser = Depends(verify_supabase_jwt),
) -> TokenResponse:
    # Validasi scenario_id SETELAH auth agar caller tak-terautentikasi tak bisa
    # menyelidiki daftar skenario (dapat 401 lebih dulu, bukan 422).
    if req.scenario_id not in VALID_SCENARIOS:
        raise HTTPException(422, "scenario_id tidak dikenal")
    if not (LIVEKIT_API_KEY and LIVEKIT_API_SECRET and LIVEKIT_URL):
        raise HTTPException(500, "Kredensial LiveKit belum dikonfigurasi di .env")

    room = f"{req.scenario_id}-{uuid.uuid4().hex[:8]}"

    token = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        # Identitas peserta = Supabase sub (dulu player-<uuid8> acak) → sesi bisa
        # diatribusikan ke user server-side. Metadata peserta (tepercaya, dari JWT
        # terverifikasi) membawa user_id + is_anonymous untuk jalur worker nanti.
        # Stamp HANYA kunci ini — JANGAN user.claims (bisa memuat email/phone).
        .with_identity(user.user_id)
        .with_name("Petugas")
        .with_ttl(LIVEKIT_TOKEN_TTL)
        .with_metadata(
            json.dumps({"user_id": user.user_id, "is_anonymous": user.is_anonymous})
        )
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
