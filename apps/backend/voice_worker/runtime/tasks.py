"""Task latar yang referensinya disimpan (GOTCHA #2).

Event loop hanya memegang weak reference ke task → task bisa di-GC sebelum selesai
(observer sempat "acak tidak jalan" karena ini). Semua `create_task` di worker lewat sini.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

logger = logging.getLogger("koperasi.tasks")


class BackgroundTasks:
    def __init__(self) -> None:
        self._tasks: set[asyncio.Task] = set()

    def spawn(self, coro: Coroutine[Any, Any, Any], *, name: str) -> asyncio.Task:
        task = asyncio.create_task(coro, name=name)
        self._tasks.add(task)

        def _done(t: asyncio.Task) -> None:
            self._tasks.discard(t)
            if not t.cancelled() and t.exception() is not None:
                logger.error("Task latar %r gagal", name, exc_info=t.exception())

        task.add_done_callback(_done)
        return task

    def cancel_all(self) -> None:
        for task in list(self._tasks):
            task.cancel()
