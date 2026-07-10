"""Observer drift — Lapisan 2 (PRD §6).

Panggilan gpt-5-mini asinkron & non-blocking yang menilai tiap giliran pemain:
apakah ia menyimpang (escalate), netral, atau membaik (deescalate) terhadap
dimensi drift skenario. `DriftTracker` mengubah rentetan penilaian itu jadi
level 0/1/2 dengan bias longgar — butuh beberapa giliran konsisten untuk naik.
"""

from __future__ import annotations

import json
import logging

from openai import AsyncAzureOpenAI

from scenarios import DriftSpec

logger = logging.getLogger("koperasi.observer")

_ALLOWED = {"escalate", "neutral", "deescalate"}

_SYSTEM = """\
Kamu adalah pengamat netral dalam simulasi pelatihan koperasi. Nilai HANYA giliran
terakhir pemain (petugas) terhadap deskripsi penyimpangan berikut.

Penyimpangan yang dilacak:
{dimension}

Klasifikasikan giliran pemain menjadi salah satu:
- "escalate"  : jelas menyimpang ke arah di atas.
- "deescalate": jelas memperbaiki / kembali ke pendekatan yang patut.
- "neutral"   : tidak jelas menyimpang; termasuk pertanyaan investigatif yang sah.

Bila ragu, pilih "neutral" — lebih aman menganggap perilaku wajar sebagai netral
daripada salah menuduh penyimpangan.

Balas HANYA JSON: {{"judgment": "escalate|neutral|deescalate"}}
"""


async def evaluate_turn(
    client: AsyncAzureOpenAI,
    deployment: str,
    spec: DriftSpec,
    player_text: str,
    npc_context: str,
) -> str:
    """Kembalikan 'escalate' | 'neutral' | 'deescalate' untuk giliran pemain."""
    try:
        resp = await client.chat.completions.create(
            model=deployment,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM.format(dimension=spec.dimension)},
                {
                    "role": "user",
                    "content": (
                        f"Ucapan NPC sebelumnya: {npc_context or '(tidak ada)'}\n"
                        f"Giliran pemain: {player_text}"
                    ),
                },
            ],
        )
        content = resp.choices[0].message.content or "{}"
        judgment = json.loads(content).get("judgment", "neutral")
        return judgment if judgment in _ALLOWED else "neutral"
    except Exception:  # noqa: BLE001 — observer tak boleh menjatuhkan sesi
        logger.exception("Observer gagal menilai giliran; anggap netral.")
        return "neutral"


class DriftTracker:
    """State drift per sesi. Level bisa naik & turun (PRD §6)."""

    def __init__(self, spec: DriftSpec) -> None:
        self._spec = spec
        self._streak = 0
        self.level = 0

    def apply(self, judgment: str) -> int:
        """Perbarui streak dari penilaian, kembalikan level terkini (0/1/2)."""
        if judgment == "escalate":
            self._streak += 1
        elif judgment == "deescalate":
            self._streak = max(0, self._streak - 1)
        # "neutral" tidak menggeser streak.

        if self._streak >= self._spec.level2_streak:
            self.level = 2
        elif self._streak >= self._spec.level1_streak:
            self.level = 1
        else:
            self.level = 0
        return self.level
