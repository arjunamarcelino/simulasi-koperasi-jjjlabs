"""Satu NPC RAT: Agent + sesi Gemini Live sendiri, TANPA telinga.

Sesi NPC dibuat dengan `audio_input=False` & `text_input=False` (I1), jadi NPC hanya
bicara saat `generate_reply()` dipanggil `Discussion`. Suara terikat ke sesi sejak
konstruksi (`RealtimeModel(voice=...)`) → transisi fase tak bisa menukar suara (bug lama
"Pak Darma bersuara Ibu Sri").
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable

from livekit import rtc
from livekit.agents import Agent, ModelSettings

from gemini.client import make_realtime_model
from prompts.rat_meja import RAT_MEJA_RULES
from rat.floor import Floor
from scenarios import RatPhase, RatSpec

logger = logging.getLogger("koperasi.rat.npc")


def build_instructions(rat: RatSpec, key: str, phase: RatPhase) -> str:
    """Prompt persona + aturan "satu mulut" + tahap rapat saat ini."""
    assert len(rat.personas) == 2, "aturan forum mengasumsikan TEPAT dua NPC"
    persona = rat.persona(key)
    rekan = next(p.name for p in rat.personas if p.key != key)
    return (
        f"{persona.prompt}\n"
        f"{RAT_MEJA_RULES.format(rekan=rekan)}\n"
        f"## Tahap rapat saat ini\nFase {phase.id} — {phase.label}.\n"
    )


class NpcAgent(Agent):
    def __init__(
        self, *, key: str, voice: str, instructions: str, floor: Floor, playout_tail: float
    ) -> None:
        # Instruksi diberikan ke keduanya; yang dikirim framework adalah
        # `agent.instructions` (spec §5.3) — itu sumber kebenaran.
        super().__init__(
            instructions=instructions,
            llm=make_realtime_model(voice=voice, instructions=instructions),
        )
        self.key = key
        self._floor = floor
        self._playout_tail = playout_tail
        # Total detik audio yang sudah dikeluarkan NPC ini (kumulatif). `Discussion`
        # membandingkan nilai sebelum/sesudah giliran untuk mendeteksi giliran tanpa suara.
        self.spoken_audio_s = 0.0

    async def realtime_audio_output_node(
        self, audio: AsyncIterable[rtc.AudioFrame], model_settings: ModelSettings
    ) -> AsyncIterable[rtc.AudioFrame]:
        """Pegang lantai selama suara keluar (+ ekor playout buffer room)."""
        upstream = Agent.default.realtime_audio_output_node(self, audio, model_settings)
        frames = 0
        try:
            async with self._floor.hold(self.key):
                async for frame in upstream:
                    frames += 1
                    self.spoken_audio_s += frame.duration
                    yield frame
                await asyncio.sleep(self._playout_tail)
        finally:
            # Diagnosis giliran senyap: node DIPANGGIL tapi stream audio Gemini kosong →
            # audio hilang di plugin/Gemini (jalankan LK_GOOGLE_DEBUG=1). Bila giliran
            # senyap TANPA log ini, node tak dipanggil sama sekali (pesan tanpa modal audio).
            if frames == 0:
                logger.warning("%s: giliran berakhir tanpa satu frame audio pun dari Gemini", self.key)
