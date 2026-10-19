"""Konfigurasi worker dari env — satu-satunya tempat membaca env Google & konstanta tuning.

Nama model SELALU dari env (GOTCHA #6 lama: jangan hardcode nama model). Default di sini
hanya nilai awal yang diuji di proyek latihan; akun produksi bisa berbeda (spec §10).

Kredensial:
- Gemini Live + panggilan JSON (observer/auditor/mentor/direktur): AI Studio via
  `GOOGLE_API_KEY` (default), atau Vertex AI bila `GOOGLE_GENAI_USE_VERTEXAI=true`
  (+ `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`).
- Cloud STT (pendengar RAT): Application Default Credentials / `GOOGLE_APPLICATION_CREDENTIALS`.
  BUKAN `GOOGLE_API_KEY` — tanpa ADC konstruktor `google.STT` melempar ValueError.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw and raw.strip() else default


@dataclass(frozen=True)
class GoogleAuth:
    use_vertexai: bool
    api_key: str | None
    project: str | None
    location: str | None


@dataclass(frozen=True)
class Models:
    live: str  # NPC suara (Gemini Live)
    director: str  # RAT: siapa bicara berikutnya
    observer: str  # Lapisan 2
    mentor: str  # Petunjuk
    auditor: str  # Lapisan 3


@dataclass(frozen=True)
class RatTuning:
    """Konstanta arsitektur "Telinga ≠ Mulut" (spec §5.1). Nilai awal dari referensi."""

    stt_language: str
    transcript_settle_delay: float  # jeda sebelum direktur dipanggil setelah giliran NPC
    user_turn_debounce: float  # gabungkan potongan FINAL STT jadi satu giliran
    echo_guard_budget: float  # detik audio mic yang dibisukan saat NPC bicara (sekali seumur sesi)
    playout_tail: float  # lantai bicara ditahan setelah frame terakhir
    director_timeout: float  # F3: batas tunggu direktur; habis → fallback
    # NPC boleh saling menyambung paling banyak sekian giliran sebelum wajib balik ke
    # pemain; dihitung ulang dari 0 tiap pemain bicara (MAX_NPC_EXCHANGES kode latihan).
    max_npc_exchanges: int
    # Batas NPC saling SANGGAH (alasan direktur "diserang") per giliran pemain.
    max_npc_rebuttals: int


def google_auth() -> GoogleAuth:
    return GoogleAuth(
        use_vertexai=_bool("GOOGLE_GENAI_USE_VERTEXAI"),
        api_key=os.environ.get("GOOGLE_API_KEY") or None,
        project=os.environ.get("GOOGLE_CLOUD_PROJECT") or None,
        location=os.environ.get("GOOGLE_CLOUD_LOCATION") or None,
    )


def models() -> Models:
    return Models(
        live=os.environ.get("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview"),
        director=os.environ.get("GEMINI_DIRECTOR_MODEL", "gemini-3.5-flash-lite"),
        observer=os.environ.get("GEMINI_OBSERVER_MODEL", "gemini-3.5-flash-lite"),
        mentor=os.environ.get("GEMINI_MENTOR_MODEL", "gemini-3.5-flash-lite"),
        auditor=os.environ.get("GEMINI_AUDITOR_MODEL", "gemini-3.5-flash"),
    )


def rat_tuning() -> RatTuning:
    return RatTuning(
        stt_language=os.environ.get("RAT_STT_LANGUAGE", "id-ID"),
        transcript_settle_delay=_float("RAT_TRANSCRIPT_SETTLE_DELAY", 0.2),
        user_turn_debounce=_float("RAT_USER_TURN_DEBOUNCE", 0.7),
        echo_guard_budget=_float("RAT_ECHO_GUARD_BUDGET", 3.0),
        playout_tail=_float("RAT_PLAYOUT_TAIL", 0.4),
        # Kode latihan menunggu direktur tanpa batas; batas longgar ini hanya pengaman.
        # (4 dtk terlalu ketat: flash-lite kadang >4 dtk → fallback ke pemimpin fase.)
        director_timeout=_float("RAT_DIRECTOR_TIMEOUT", 10.0),
        max_npc_exchanges=int(_float("RAT_MAX_NPC_EXCHANGES", 4)),
        max_npc_rebuttals=int(_float("RAT_MAX_NPC_REBUTTALS", 1)),
    )


AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "koperasi-agent")
