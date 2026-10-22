"""Koneksi room tambahan untuk NPC kedua (I3).

Satu participant = satu track mic. Dua track `SOURCE_MICROPHONE` dari participant yang
sama tidak dirender klien, jadi NPC kedua bergabung sebagai participant TERPISAH dengan
token sendiri. `can_subscribe=False`: NPC tak perlu (dan tak boleh) mendengar siapa pun.
"""

from __future__ import annotations

import logging
import os

from livekit import api, rtc

from scenarios import Persona

logger = logging.getLogger("koperasi.rat.connection")


def npc_token(room_name: str, persona: Persona) -> str:
    return (
        api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(persona.identity)
        .with_name(persona.name)
        .with_grants(
            api.VideoGrants(
                room_join=True, room=room_name, can_publish=True, can_subscribe=False
            )
        )
        .to_jwt()
    )


async def connect_as_npc(room_name: str, persona: Persona) -> rtc.Room:
    room = rtc.Room()
    await room.connect(os.environ["LIVEKIT_URL"], npc_token(room_name, persona))
    logger.info("%s tersambung sebagai participant terpisah", persona.identity)
    return room
