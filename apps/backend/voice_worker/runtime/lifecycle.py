"""Akhir sesi — tiga jalur (PRD §6) dengan SATU hasil per sesi.

`manual` (RPC `end_session`) dan `force_quit_level_2` (observer) berbagi satu future:
siapa pun yang datang duluan menjalankan finalize (auditor) sekali; yang datang kemudian
menerima hasil yang sama. Ini menutup race worker lama, di mana `ended` di-set SETELAH
`await interrupt()` sehingga auditor bisa berjalan dua kali.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from runtime.publisher import Publisher

logger = logging.getLogger("koperasi.lifecycle")

TRIGGER_MANUAL = "manual"
TRIGGER_FORCE_QUIT = "force_quit_level_2"


class SessionLifecycle:
    def __init__(
        self,
        *,
        stop_speaking: Callable[[], Awaitable[None]],
        finalize: Callable[[str], Awaitable[dict]],
        publisher: Publisher,
    ) -> None:
        self._stop_speaking = stop_speaking
        self._finalize = finalize
        self._publisher = publisher
        self._result: asyncio.Future[dict] | None = None

    @property
    def ended(self) -> bool:
        return self._result is not None

    async def end_manual(self) -> dict:
        return await self._finish(TRIGGER_MANUAL)

    async def force_quit(self) -> None:
        first = self._result is None
        result = await self._finish(TRIGGER_FORCE_QUIT)
        if first:
            # Hanya jalur force-quit yang mengirim data message; jalur manual
            # menerima hasil lewat balasan RPC.
            await self._publisher.session_ended(result)

    async def _finish(self, trigger: str) -> dict:
        if self._result is None:
            logger.info("Sesi berakhir (trigger=%s)", trigger)
            # Di-set SINKRON sebelum await apa pun → `ended` langsung True.
            self._result = asyncio.ensure_future(self._run(trigger))
        return await asyncio.shield(self._result)

    async def _run(self, trigger: str) -> dict:
        try:
            await self._stop_speaking()
        except Exception:  # noqa: BLE001 — gagal menghentikan suara tak boleh membatalkan hasil
            logger.warning("Gagal menghentikan NPC saat akhir sesi", exc_info=True)
        return await self._finalize(trigger)
