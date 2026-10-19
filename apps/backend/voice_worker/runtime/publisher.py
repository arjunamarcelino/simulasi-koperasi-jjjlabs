"""Semua sinyal agent → FE (CONTRACT.md §4) lewat SATU koneksi: koneksi worker.

Attribute dipasang di participant worker (FE membaca `ParticipantAttributesChanged`
dari participant mana pun), data message dikirim dari worker. Nama topic/attribute
dan bentuk payload TIDAK berubah dari worker lama.
"""

from __future__ import annotations

import json
import logging

from livekit import rtc

logger = logging.getLogger("koperasi.publisher")

SESSION_ENDED_TOPIC = "session_ended"
# Sinyal "siapa yang bicara" per giliran NPC — FE melabeli transkripsi NPC dengan ini.
SPEAKER_TOPIC = "speaker"


class Publisher:
    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        self._goal_reached = False

    async def speaker(self, name: str) -> None:
        await self._room.local_participant.publish_data(
            json.dumps({"name": name}), topic=SPEAKER_TOPIC
        )

    async def drift_level(self, level: int) -> None:
        await self._room.local_participant.set_attributes({"drift_level": str(level)})

    async def phase(self, phase_id: int, label: str, advance_action_label: str | None) -> None:
        payload = {"phase": phase_id, "label": label, "advanceActionLabel": advance_action_label}
        await self._room.local_participant.set_attributes({"phase": json.dumps(payload)})

    async def goal_reached(self) -> None:
        """Idempoten — publish sekali saja."""
        if self._goal_reached:
            return
        self._goal_reached = True
        await self._room.local_participant.set_attributes({"goal_reached": "1"})
        logger.info("Tujuan skenario tercapai — publish goal_reached=1")

    async def session_ended(self, result: dict) -> None:
        await self._room.local_participant.publish_data(
            json.dumps(result), topic=SESSION_ENDED_TOPIC
        )
