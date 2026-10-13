"""Registrasi RPC FE → agent (CONTRACT.md §3) di SATU atau LEBIH koneksi.

RAT punya dua participant NPC. FE (`LiveKitTransport.markAgentReady`) mengirim RPC ke
participant remote PERTAMA yang ia lihat, yang bisa saja koneksi NPC kedua. Mendaftarkan
handler yang sama di semua koneksi membuat RPC berhasil ke mana pun ia dikirim, tanpa
mengubah FE.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable

from livekit import rtc

RpcHandler = Callable[[rtc.RpcInvocationData], Awaitable[str]]


def register_rpcs(rooms: Iterable[rtc.Room], handlers: dict[str, RpcHandler]) -> None:
    for room in rooms:
        for method, handler in handlers.items():
            room.local_participant.register_rpc_method(method, handler)
