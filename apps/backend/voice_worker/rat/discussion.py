"""Discussion: transkrip bersama + pemilihan giliran + fase untuk RAT.

Satu-satunya pihak yang menyuruh NPC bicara (`generate_reply`). Telinga (Listener)
memberi teks pemain; direktur memilih pembicara; NPC tanpa telinga menurut (I1, I4).

Invarian yang dijaga di sini (spec §4): I4 rantai giliran diserialkan dengan
`await handle`; I5 barge-in = batalkan rantai DAN interrupt semua sesi; I6 transkrip
ditulis SINKRON sebelum direktur; I7 mirror berformat "[Nama berbicara] ..." dengan
satu lock per NPC; I8 guard direktur; I10 atribusi NPC (F1).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from livekit.agents import AgentSession

from rat import director
from rat.floor import Floor
from rat.npc import NpcAgent, build_instructions
from runtime.publisher import Publisher
from runtime.tasks import BackgroundTasks
from scenarios import RatPhase, RatSpec

logger = logging.getLogger("koperasi.rat.discussion")

PLAYER_NAME = "Pimpinan"  # sebutan pemain di forum (prompt NPC memakai "Pimpinan")
PHASE_SETTLE_TIMEOUT = 3.0  # batas tunggu suara NPC berhenti sebelum fase berganti


@dataclass(frozen=True)
class TranscriptEntry:
    ts: float
    key: str | None  # None = pemain
    name: str
    text: str
    phase_id: int

    @property
    def is_player(self) -> bool:
        return self.key is None


TranscriptListener = Callable[[TranscriptEntry], None]


class Discussion:
    def __init__(
        self,
        *,
        rat: RatSpec,
        floor: Floor,
        publisher: Publisher,
        tasks: BackgroundTasks,
        director_client: Any,
        director_model: str,
        director_timeout: float,
        settle_delay: float,
    ) -> None:
        self._rat = rat
        self._floor = floor
        self._publisher = publisher
        self._tasks = tasks
        self._director_client = director_client
        self._director_model = director_model
        self._director_timeout = director_timeout
        self._settle_delay = settle_delay

        self.sessions: dict[str, AgentSession] = {}
        self.agents: dict[str, NpcAgent] = {}
        self._agent_locks: dict[str, asyncio.Lock] = {}

        self._entries: list[TranscriptEntry] = []
        self._listeners: list[TranscriptListener] = []
        self._pending_mirrors: set[asyncio.Task] = set()
        self._chain: asyncio.Task[None] | None = None
        self._phase_index = 0
        self._phase_lock = asyncio.Lock()
        self._closed = False

    # ---------- registrasi (I9: SEBELUM session.start) ----------

    def register(self, key: str, agent: NpcAgent, session: AgentSession) -> None:
        self.agents[key] = agent
        self.sessions[key] = session
        self._agent_locks[key] = asyncio.Lock()

    def add_transcript_listener(self, cb: TranscriptListener) -> None:
        self._listeners.append(cb)

    # ---------- state baca ----------

    @property
    def phase(self) -> RatPhase:
        return self._rat.phases[self._phase_index]

    @property
    def closed(self) -> bool:
        return self._closed

    def last_npc_text(self) -> str:
        return next((e.text for e in reversed(self._entries) if not e.is_player), "")

    def transcript_tail(self, n: int = director.TRANSCRIPT_WINDOW) -> list[str]:
        return [f"{e.name}: {e.text}" for e in self._entries[-n:]]

    def evaluation_transcript(self) -> list[tuple[str, str]]:
        """Untuk auditor/mentor: ("user", teks) untuk pemain, (nama NPC, teks) untuk NPC —
        `_format_transcript` mereka menulis peran tak dikenal sebagai NAMA KAPITAL, jadi
        auditor tahu persis siapa (Darma/Sri) yang mengatakan apa."""
        return [("user" if e.is_player else e.name, e.text) for e in self._entries]

    # ---------- transkrip & saling mendengar ----------

    def _append(self, key: str | None, name: str, text: str) -> TranscriptEntry:
        """SINKRON (I6) — direktur & listener langsung melihat entri terbaru."""
        entry = TranscriptEntry(time.time(), key, name, text, self.phase.id)
        self._entries.append(entry)
        logger.info("transkrip << %s: %s", name, text)
        for cb in self._listeners:
            try:
                cb(entry)
            except Exception:  # noqa: BLE001 — listener tak boleh mengganggu giliran
                logger.warning("transcript listener gagal", exc_info=True)
        return entry

    async def _mirror(self, speaker_name: str, text: str, targets: list[str]) -> None:
        await asyncio.gather(*(self._mirror_one(k, speaker_name, text) for k in targets))

    async def _mirror_one(self, key: str, speaker_name: str, text: str) -> None:
        agent = self.agents.get(key)
        if agent is None:
            return
        # Satu lock per NPC: update_chat_ctx = read-modify-write (I7).
        async with self._agent_locks[key]:
            try:
                ctx = agent.chat_ctx.copy()
                # BUKAN "Nama: ucapan" — format skrip ditiru model lalu ia mengarang
                # dialog atas nama rekannya.
                ctx.add_message(role="user", content=f"[{speaker_name} berbicara] {text}")
                await agent.update_chat_ctx(ctx)
            except Exception:  # noqa: BLE001
                logger.warning("gagal mencerminkan ke %s", key, exc_info=True)

    def _strip_impersonation(self, key: str, text: str) -> str:
        """F1: buang awalan palsu "Nama:" — ucapan TETAP atas nama `key` (suara yang
        didengar pemain), lalu dicerminkan ke NPC selain `key`."""
        head = text.lstrip()
        for p in self._rat.personas:
            prefix = f"{p.name}:"
            if head.lower().startswith(prefix.lower()):
                if p.key != key:
                    logger.warning(
                        "%s menulis awalan atas nama %s — awalan dibuang",
                        self._rat.persona(key).name, p.name,
                    )
                return head[len(prefix):].lstrip()
        return text

    def on_npc_said(self, key: str, text: str) -> None:
        """Dipanggil dari `conversation_item_added` (role assistant) sesi NPC `key`."""
        text = self._strip_impersonation(key, text).strip()
        if not text:
            return
        name = self._rat.persona(key).name
        self._append(key, name, text)
        others = [k for k in self.agents if k != key]
        task = self._tasks.spawn(self._mirror(name, text, others), name=f"mirror-{key}")
        self._pending_mirrors.add(task)
        task.add_done_callback(self._pending_mirrors.discard)

    async def _drain_mirrors(self) -> None:
        """Pastikan ucapan NPC sebelumnya sudah masuk konteks NPC lain SEBELUM giliran
        berikutnya dimulai (kalau tidak, NPC bisa menanggapi tanpa tahu apa yang barusan
        dikatakan rekannya)."""
        if self._pending_mirrors:
            await asyncio.gather(*self._pending_mirrors, return_exceptions=True)

    # ---------- giliran pemain ----------

    def on_user_started(self) -> None:
        """Barge-in (I5): batalkan rantai DAN hentikan suara. `await handle` di rantai
        dibungkus `asyncio.shield`, jadi membatalkan rantai saja tak menghentikan suara."""
        self._cancel_chain()
        self._interrupt_all(force=False)

    async def on_user_said(self, text: str) -> None:
        text = text.strip()
        if self._closed or not text:
            return
        self._cancel_chain()
        self._append(None, PLAYER_NAME, text)

        mirror = asyncio.ensure_future(self._mirror(PLAYER_NAME, text, list(self.agents)))
        try:
            # Nama disebut tepat satu → deterministik, tanpa direktur (lebih cepat & pasti).
            speaker = director.mentioned_persona(text, self._rat.name_mentions)
            if speaker is None:
                speaker = await director.decide(
                    self._director_client,
                    self._director_model,
                    personas=self._rat.personas,
                    phase=self.phase,
                    transcript_tail=self.transcript_tail(),
                    after_npc_turn=False,
                    last_speaker=None,
                    fallback=self.phase.default_persona,
                    timeout=self._director_timeout,
                )
            else:
                logger.info("nama disebut → %s (tanpa direktur)", speaker)
            await mirror  # konteks WAJIB sudah masuk sebelum NPC diminta bicara
        except asyncio.CancelledError:
            mirror.cancel()
            raise
        if not self._closed:
            self.start_chain(speaker)

    # ---------- rantai giliran NPC → NPC ----------

    def _cancel_chain(self) -> None:
        if self._chain is not None and not self._chain.done():
            self._chain.cancel()
        self._chain = None

    def _interrupt_all(self, *, force: bool) -> list[asyncio.Future]:
        futs: list[asyncio.Future] = []
        for key, session in self.sessions.items():
            try:
                futs.append(session.interrupt(force=force))
            except RuntimeError:
                logger.debug("interrupt %s dilewati", key, exc_info=True)
        return futs

    def start_chain(self, speaker: str, *, instructions: str | None = None) -> None:
        """Mulai rantai giliran dari `speaker`. `instructions` = giliran TERJADWAL
        (sapaan, interupsi fase) — hanya untuk giliran pertama; berikutnya direktur."""
        self._cancel_chain()
        self._chain = self._tasks.spawn(
            self._run_chain(speaker, instructions), name=f"chain-{speaker}"
        )

    async def _run_chain(self, speaker: str, instructions: str | None) -> None:
        exchanges = 0
        limit = self.phase.max_npc_exchanges
        try:
            while True:
                exchanges += 1
                logger.info("giliran -> %s (pertukaran %d/%d)", speaker, exchanges, limit)
                await self._drain_mirrors()
                await self._publisher.speaker(self._rat.persona(speaker).name)
                session = self.sessions[speaker]
                try:
                    handle = (
                        session.generate_reply(instructions=instructions)
                        if instructions
                        else session.generate_reply()
                    )
                except RuntimeError:  # F4: sesi tak berjalan → berhenti, jangan crash
                    logger.warning("generate_reply %s gagal dimulai", speaker, exc_info=True)
                    return
                instructions = None
                await handle  # menunggu PLAYOUT selesai; tak pernah raise (I4)
                if handle.exception() is not None:
                    logger.warning("generate_reply %s gagal: %s", speaker, handle.exception())
                    return
                if exchanges >= limit:  # F4: tak memanggil direktur yang hasilnya dibuang
                    logger.info("batas %d pertukaran tercapai, giliran balik ke pemain", limit)
                    return
                await asyncio.sleep(self._settle_delay)  # biar ucapan masuk transkrip
                nxt = await director.decide(
                    self._director_client,
                    self._director_model,
                    personas=self._rat.personas,
                    phase=self.phase,
                    transcript_tail=self.transcript_tail(),
                    after_npc_turn=True,
                    last_speaker=speaker,
                    fallback=director.WAIT_FOR_USER,
                    timeout=self._director_timeout,
                )
                if nxt == director.WAIT_FOR_USER:
                    return
                speaker = nxt
        except asyncio.CancelledError:
            logger.info("rantai giliran dibatalkan")
            raise

    # ---------- fase (RPC advance_phase) ----------

    async def advance_phase(self) -> bool:
        """Maju satu fase. False bila sudah fase terakhir / sesi selesai (→ "noop").

        Diserialkan dengan lock + idempoten. Fase TIDAK berganti selagi NPC bicara (AC10):
        rantai dibatalkan, suara dihentikan, lalu ditunggu sampai lantai kosong.
        """
        async with self._phase_lock:
            if self._closed or self._phase_index >= len(self._rat.phases) - 1:
                return False
            self._cancel_chain()
            await asyncio.gather(*self._interrupt_all(force=True), return_exceptions=True)
            await self._floor.wait_idle(PHASE_SETTLE_TIMEOUT)

            self._phase_index += 1
            phase = self.phase
            await asyncio.gather(
                *(
                    agent.update_instructions(build_instructions(self._rat, key, phase))
                    for key, agent in self.agents.items()
                )
            )
            await self._publisher.phase(phase.id, phase.label, phase.advance_action_label)
            logger.info("Fase → %d (%s)", phase.id, phase.label)

            if phase.entry_line is not None:
                persona_key, line = phase.entry_line
                # Giliran TERJADWAL (spec §6.4): menggantikan direktur untuk giliran ini.
                self.start_chain(
                    persona_key,
                    instructions=(
                        "Kamu menyela rapat sekarang. Ucapkan PERSIS kalimat berikut, tanpa "
                        f'menambah atau mengubah kata: "{line}"'
                    ),
                )
            return True

    # ---------- akhir sesi ----------

    async def close(self) -> None:
        """Hentikan semua giliran & suara; input berikutnya diabaikan. Idempoten."""
        self._closed = True
        self._cancel_chain()
        await asyncio.gather(*self._interrupt_all(force=True), return_exceptions=True)
