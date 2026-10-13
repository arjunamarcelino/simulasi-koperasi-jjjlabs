"""Skema validasi gagal-aman untuk output JSON AI Auditor (SIM-21).

Model ini MEMVALIDASI output LLM yang tak tepercaya, BUKAN kontrak wire FastAPI.
Filosofinya kebalikan dari model ketat di `api/server.py` (`extra="forbid"`,
`Literal`, raise → 422): di sini raise = menjatuhkan hasil audit, jadi semua
validator MENYESUAIKAN (coerce), tak pernah menolak. Lihat CLAUDE.md GOTCHA #7.

Hanya envelope yang stabil yang divalidasi; nama key `scores`/`stateClassification`
berbeda antar skenario → sengaja TIDAK dienumerasi (pelajaran SIM-16). `scenarioId`
& `trigger` TIDAK ada di sini — keduanya di-stamp oleh `run_auditor` setelah parse.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Sumbu auditor (CONTRACT.md §5) — BEDA dari _ALLOWED observer
# ({escalate,neutral,deescalate}); jangan dicampur.
_ALLOWED_ENDINGS = {"good", "bad", "neutral"}

_MAX_KEYS = 50  # batas jumlah key (pertahanan berlapis vs output LLM membengkak)


def _as_str(v: Any) -> str:
    """Paksa nilai jadi str; None → "" (jangan buang isi yang masih berguna)."""
    if isinstance(v, str):
        return v
    return "" if v is None else str(v)


class AuditorResult(BaseModel):
    """Bentuk `AuditorResult` yang dikonsumsi FE (CONTRACT.md §5).

    `model_validate` nyaris tak pernah raise karena validator `mode="before"`
    menyerap nilai salah-tipe/di-luar-rentang lebih dulu. Jaring pengaman
    terakhir tetap blok `try/except` di `run_auditor` (mis. input non-dict).
    """

    model_config = ConfigDict(extra="ignore")  # buang key LLM nyasar, jangan raise

    stateClassification: dict[str, str] = Field(default_factory=dict)
    scores: dict[str, int] = Field(default_factory=dict)
    endingType: str = "neutral"
    narrativeFeedback: str = Field(default="", max_length=4000)

    @field_validator("endingType", mode="before")
    @classmethod
    def _coerce_ending(cls, v: Any) -> str:
        """Nilai tak dikenal / salah-tipe → "neutral" (seperti observer)."""
        return v if isinstance(v, str) and v in _ALLOWED_ENDINGS else "neutral"

    @field_validator("stateClassification", mode="before")
    @classmethod
    def _coerce_state(cls, v: Any) -> dict[str, str]:
        """Salvage per-key: non-dict → {}; tiap nilai dipaksa jadi str."""
        if not isinstance(v, dict):
            return {}
        return {str(k): _as_str(val) for k, val in list(v.items())[:_MAX_KEYS]}

    @field_validator("scores", mode="before")
    @classmethod
    def _coerce_scores(cls, v: Any) -> dict[str, int]:
        """Salvage per-key: clamp ke 0–100; satu nilai buruk tak merusak sisanya."""
        if not isinstance(v, dict):
            return {}
        out: dict[str, int] = {}
        for k, n in list(v.items())[:_MAX_KEYS]:
            try:
                out[str(k)] = max(0, min(100, int(float(n))))
            except (TypeError, ValueError):
                continue  # buang nilai tak-ternumerik, pertahankan key lain
        return out
