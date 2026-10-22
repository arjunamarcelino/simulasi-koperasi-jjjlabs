"""Skema validasi gagal-aman untuk output JSON AI Auditor (SIM-21).

Model ini MEMVALIDASI output LLM yang tak tepercaya, BUKAN kontrak wire FastAPI.
Filosofinya kebalikan dari model ketat di `api/server.py` (`extra="forbid"`,
`Literal`, raise → 422): di sini raise = menjatuhkan hasil audit, jadi semua
validator MENYESUAIKAN (coerce), tak pernah menolak. Lihat CLAUDE.md GOTCHA #7.

Hanya envelope yang stabil yang divalidasi; nama key `scores`/`stateClassification`
berbeda antar skenario → sengaja TIDAK dienumerasi (pelajaran SIM-16). `scenarioId`
& `trigger` TIDAK ada di sini — keduanya di-stamp oleh `run_auditor` setelah parse.
Begitu pula `trend` per nilai ICA: dihitung kode dari riwayat, bukan dari LLM.

`HistoryEntry`/`parse_history` memvalidasi riwayat pemain yang datang dari job metadata
dispatch (dikirim FE lewat `/token`) dengan filosofi yang sama: entri buruk dibuang,
tak pernah raise.
"""

from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

# Sumbu auditor (CONTRACT.md §5) — BEDA dari _ALLOWED observer
# ({escalate,neutral,deescalate}); jangan dicampur.
_ALLOWED_ENDINGS = {"good", "bad", "neutral"}

_MAX_KEYS = 50  # batas jumlah key (pertahanan berlapis vs output LLM membengkak)
_MAX_NARRATIVE = 4000  # batas panjang narasi (selaras size-guard DB, SIM-15)
_MAX_STATE_LEN = 200  # batas panjang per kunci/nilai state (hindari str() objek besar)

# Nilai ICA (feedback personal). Status = penilaian LLM per sesi; tren = hitungan kode.
VALUE_STATUSES = ("TERCERMIN", "BELUM_TAMPAK", "DIABAIKAN")
VALUE_STATUS_RANK = {"DIABAIKAN": 0, "BELUM_TAMPAK": 1, "TERCERMIN": 2}
VALUE_TRENDS = ("MENGUAT", "TETAP", "MELEMAH", "BARU_DIUJI")
_DEFAULT_VALUE_STATUS = "BELUM_TAMPAK"  # status tak dikenal → netral, bukan vonis
_MAX_EVIDENCE = 200  # satu kalimat bukti per nilai (prompt meminta ≤160)
_MAX_PROGRESS = 2000  # narasi "Perjalanan Nilaimu" (selaras size-guard DB)
_MAX_NEXT_STEP = 300  # satu kalimat saran sesi berikutnya
MAX_HISTORY = 5  # sesi terakhir yang dipakai sebagai pembanding (selaras /token)


def _as_str(v: Any) -> str:
    """Paksa nilai jadi str; None → "" (jangan buang isi yang masih berguna)."""
    if isinstance(v, str):
        return v
    return "" if v is None else str(v)


class ValueAssessment(BaseModel):
    """Penilaian satu nilai ICA dalam satu sesi: status + satu kalimat bukti perilaku."""

    model_config = ConfigDict(extra="ignore")

    status: str = _DEFAULT_VALUE_STATUS
    evidence: str = Field(default="", max_length=_MAX_EVIDENCE)

    @field_validator("status", mode="before")
    @classmethod
    def _coerce_status(cls, v: Any) -> str:
        """Tak peka huruf; nilai tak dikenal / salah-tipe → BELUM_TAMPAK."""
        status = v.strip().upper() if isinstance(v, str) else ""
        return status if status in VALUE_STATUS_RANK else _DEFAULT_VALUE_STATUS

    @field_validator("evidence", mode="before")
    @classmethod
    def _coerce_evidence(cls, v: Any) -> str:
        return _as_str(v)[:_MAX_EVIDENCE]


def _coerce_value_map(v: Any) -> dict[str, Any]:
    """Salvage per-key: non-dict → {}; item yang bukan objek dibuang."""
    if not isinstance(v, dict):
        return {}
    return {
        str(k)[:_MAX_STATE_LEN]: item
        for k, item in list(v.items())[:_MAX_KEYS]
        if isinstance(item, dict)
    }


class AuditorResult(BaseModel):
    """Bentuk `AuditorResult` yang dikonsumsi FE (CONTRACT.md §5).

    `model_validate` nyaris tak pernah raise karena validator `mode="before"`
    menyerap nilai salah-tipe/di-luar-rentang lebih dulu. Jaring pengaman
    terakhir tetap blok `try/except` di `run_auditor` (mis. input non-dict).
    """

    # extra="ignore" memang default pydantic v2 — ditulis EKSPLISIT sebagai
    # dokumentasi (kebalikan dari extra="forbid" di api/server.py) sekaligus penopang
    # anti-spoof: scenarioId/trigger dari LLM dibuang sebelum di-stamp server.
    model_config = ConfigDict(extra="ignore")

    stateClassification: dict[str, str] = Field(default_factory=dict)
    scores: dict[str, int] = Field(default_factory=dict)
    endingType: str = "neutral"
    narrativeFeedback: str = Field(default="", max_length=_MAX_NARRATIVE)
    # Feedback personal berbasis nilai ICA — kosong bila auditor gagal (FE menyembunyikan).
    values: dict[str, ValueAssessment] = Field(default_factory=dict)
    progressFeedback: str = Field(default="", max_length=_MAX_PROGRESS)
    nextStep: str = Field(default="", max_length=_MAX_NEXT_STEP)

    @field_validator("endingType", mode="before")
    @classmethod
    def _coerce_ending(cls, v: Any) -> str:
        """Nilai tak dikenal / salah-tipe → "neutral" (seperti observer)."""
        return v if isinstance(v, str) and v in _ALLOWED_ENDINGS else "neutral"

    @field_validator("narrativeFeedback", mode="before")
    @classmethod
    def _coerce_narrative(cls, v: Any) -> str:
        """Paksa jadi str & potong; narasi kepanjangan/salah-tipe/null jangan DITOLAK
        (menolak akan membuang scores/state yang sudah valid — langgar salvage)."""
        return _as_str(v)[:_MAX_NARRATIVE]

    @field_validator("stateClassification", mode="before")
    @classmethod
    def _coerce_state(cls, v: Any) -> dict[str, str]:
        """Salvage per-key: non-dict → {}; tiap nilai dipaksa jadi str."""
        if not isinstance(v, dict):
            return {}
        return {
            str(k)[:_MAX_STATE_LEN]: _as_str(val)[:_MAX_STATE_LEN]
            for k, val in list(v.items())[:_MAX_KEYS]
        }

    @field_validator("scores", mode="before")
    @classmethod
    def _coerce_scores(cls, v: Any) -> dict[str, int]:
        """Salvage per-key: clamp ke 0–100; satu nilai buruk tak merusak sisanya.

        inf → batas (100 / 0); nan serta nilai tak-ternumerik dibuang. OverflowError
        WAJIB ditangkap: `json.loads` menerima `Infinity` & integer presisi-arbitrer
        secara default, jadi `float()`/`int()` bisa meluap — jangan biarkan satu nilai
        meluap menjatuhkan seluruh audit.
        """
        if not isinstance(v, dict):
            return {}
        out: dict[str, int] = {}
        for k, n in list(v.items())[:_MAX_KEYS]:
            try:
                f = float(n)
            except (TypeError, ValueError, OverflowError):
                continue  # tak-ternumerik / int terlalu besar untuk float → buang
            if math.isnan(f):
                continue  # nan bukan skor → buang
            if math.isinf(f):
                out[str(k)[:_MAX_STATE_LEN]] = 100 if f > 0 else 0  # clamp ke batas
                continue
            out[str(k)[:_MAX_STATE_LEN]] = max(0, min(100, int(f)))
        return out

    @field_validator("values", mode="before")
    @classmethod
    def _coerce_values(cls, v: Any) -> dict[str, Any]:
        return _coerce_value_map(v)

    @field_validator("progressFeedback", mode="before")
    @classmethod
    def _coerce_progress(cls, v: Any) -> str:
        return _as_str(v)[:_MAX_PROGRESS]

    @field_validator("nextStep", mode="before")
    @classmethod
    def _coerce_next_step(cls, v: Any) -> str:
        return _as_str(v)[:_MAX_NEXT_STEP]


class HistoryEntry(BaseModel):
    """Ringkasan satu sesi lama pemain — bahan pembanding auditor (bukan instruksi)."""

    model_config = ConfigDict(extra="ignore")

    scenario_id: str = Field(min_length=1, max_length=_MAX_STATE_LEN)
    played_on: str = ""
    values: dict[str, ValueAssessment] = Field(default_factory=dict)
    next_step: str = ""

    @field_validator("played_on", mode="before")
    @classmethod
    def _coerce_played_on(cls, v: Any) -> str:
        return _as_str(v)[:32]

    @field_validator("values", mode="before")
    @classmethod
    def _coerce_values(cls, v: Any) -> dict[str, Any]:
        return _coerce_value_map(v)

    @field_validator("next_step", mode="before")
    @classmethod
    def _coerce_next_step(cls, v: Any) -> str:
        return _as_str(v)[:_MAX_NEXT_STEP]


def parse_history(raw: Any) -> list[HistoryEntry]:
    """Riwayat dari job metadata → maks `MAX_HISTORY` entri valid (terbaru dulu).

    Gagal-aman: non-list → []; entri yang tak bisa divalidasi dibuang satu per satu.
    """
    if not isinstance(raw, list):
        return []
    entries: list[HistoryEntry] = []
    for item in raw:
        if len(entries) >= MAX_HISTORY:
            break
        try:
            entries.append(HistoryEntry.model_validate(item))
        except ValidationError:
            continue
    return entries
