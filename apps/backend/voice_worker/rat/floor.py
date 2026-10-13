"""Lantai bicara: paling banyak satu NPC mengeluarkan suara pada satu waktu.

Giliran sebenarnya sudah diserialkan oleh `Discussion._run_chain` (menunggu playout
sebelum giliran berikutnya); lantai ini pengaman murah untuk jalur tak terduga, DAN
satu-satunya sumber sinyal "NPC sedang bicara" untuk proteksi echo Listener (I12).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

logger = logging.getLogger("koperasi.rat.floor")


class Floor:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._speaking: str | None = None

    @property
    def speaking(self) -> str | None:
        return self._speaking

    def npc_speaking(self) -> bool:
        return self._speaking is not None

    @contextlib.asynccontextmanager
    async def hold(self, key: str) -> AsyncIterator[None]:
        if self._lock.locked():
            # AC3: di operasi normal ini tak pernah terjadi — log agar terlihat bila ya.
            logger.warning("%s menunggu lantai (dipegang %s)", key, self._speaking)
        await self._lock.acquire()
        self._speaking = key
        try:
            yield
        finally:
            self._speaking = None
            self._lock.release()

    async def wait_idle(self, timeout: float) -> bool:
        """Tunggu sampai tak ada NPC bicara. False bila timeout (lanjut saja, jangan macet)."""
        try:
            async with asyncio.timeout(timeout):
                async with self._lock:
                    return True
        except TimeoutError:
            logger.warning("Lantai masih dipegang %s setelah %.1fs", self._speaking, timeout)
            return False
