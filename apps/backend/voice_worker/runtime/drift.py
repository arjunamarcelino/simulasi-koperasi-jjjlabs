"""Lapisan 2 terpasang ke sesi: observer per giliran pemain → level → attribute / force quit.

Dipakai kedua runner. Single-NPC memanggil `on_player_turn` dari event
`conversation_item_added`; RAT dari listener transkrip `Discussion` (di RAT ucapan
pemain tidak pernah menjadi conversation item sesi NPC — spec §6.5 / I11).
Penilaian berjalan sebagai task latar → tidak pernah memblok giliran.
"""

from __future__ import annotations

import logging
from typing import Any

from evaluation.observer import DriftTracker, evaluate_turn
from runtime.lifecycle import SessionLifecycle
from runtime.publisher import Publisher
from runtime.tasks import BackgroundTasks
from scenarios import DriftSpec

logger = logging.getLogger("koperasi.drift")


class DriftMonitor:
    def __init__(
        self,
        *,
        spec: DriftSpec,
        ai_client: Any,
        model: str,
        publisher: Publisher,
        lifecycle: SessionLifecycle,
        tasks: BackgroundTasks,
    ) -> None:
        self._spec = spec
        self._client = ai_client
        self._model = model
        self._publisher = publisher
        self._lifecycle = lifecycle
        self._tasks = tasks
        self._tracker = DriftTracker(spec)

    def on_player_turn(self, player_text: str, npc_context: str) -> None:
        if self._lifecycle.ended or not player_text.strip():
            return
        logger.info("Giliran pemain terdeteksi → jalankan observer")
        self._tasks.spawn(self._observe(player_text, npc_context), name="observer")

    async def _observe(self, player_text: str, npc_context: str) -> None:
        judgment = await evaluate_turn(
            self._client, self._model, self._spec, player_text, npc_context
        )
        # Cek ulang SETELAH await: sesi bisa berakhir selama observer berjalan.
        if self._lifecycle.ended:
            return
        prev = self._tracker.level
        level = self._tracker.apply(judgment)
        logger.info(
            "Observer: judgment=%s level=%d (prev=%d) text=%r",
            judgment, level, prev, player_text[:80],
        )
        if level != prev:
            logger.info("Drift berubah %d→%d — publish attribute", prev, level)
            await self._publisher.drift_level(level)
        if level == 2:
            logger.info("Level 2 tercapai — force quit")
            await self._lifecycle.force_quit()
