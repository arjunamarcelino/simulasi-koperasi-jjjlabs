"""FastAPI token server.

`POST /token` mint LiveKit access token dan meng-embed dispatch agent lewat
RoomConfiguration, sehingga worker (agent_name sama) otomatis bergabung ke room
baru dengan membawa `scenario_id` di job metadata (PRD §5).
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from pydantic import BaseModel

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "koperasi-agent")
CORS_ALLOW_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "http://localhost:5173")

app = FastAPI(title="Koperasi Token Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ALLOW_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
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
def create_token(req: TokenRequest) -> TokenResponse:
    if not (LIVEKIT_API_KEY and LIVEKIT_API_SECRET and LIVEKIT_URL):
        raise HTTPException(500, "Kredensial LiveKit belum dikonfigurasi di .env")

    room = f"{req.scenario_id}-{uuid.uuid4().hex[:8]}"

    token = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(f"player-{uuid.uuid4().hex[:8]}")
        .with_name("Petugas")
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
