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
VOICE_STOP_TIMEOUT = 3.0  # batas tunggu suara NPC lain berhenti sebelum giliran baru
# Gemini Live kadang menjawab TANPA audio: hanya output_transcription satu kalimat utuh,
# tanpa inline_data dan tanpa response token (terbukti di log LK_GOOGLE_DEBUG). Teks itu
# lalu diucapkan ulang sekali lewat sesi yang sama — pola yang sama dengan entry_line.
REVOICE_INSTRUCTIONS = (
    "Ucapkan PERSIS kalimat berikut dengan suaramu, tanpa menambah atau mengubah kata: "
    '"{text}"'
)


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
        max_npc_exchanges: int,
        max_npc_rebuttals: int,
    ) -> None:
        self._rat = rat
        self._floor = floor
        self._publisher = publisher
        self._tasks = tasks
        self._director_client = director_client
        self._director_model = director_model
        self._director_timeout = director_timeout
        self._settle_delay = settle_delay
        self._max_exchanges = max_npc_exchanges
        self._max_rebuttals = max_npc_rebuttals

        self.sessions: dict[str, AgentSession] = {}
        self.agents: dict[str, NpcAgent] = {}
        self._agent_locks: dict[str, asyncio.Lock] = {}

        self._entries: list[TranscriptEntry] = []
        self._listeners: list[TranscriptListener] = []
        self._pending_mirrors: set[asyncio.Task] = set()
        self._chain: asyncio.Task[None] | None = None
        # Giliran NPC sejak pemain terakhir bicara (pola kode latihan): di-reset HANYA saat
        # pemain bicara atau giliran terjadwal dimulai — rantai yang dipotong barge-in tanpa
        # ucapan baru tak mendapat jatah baru.
        self._exchanges = 0
        # SpeechHandle terakhir tiap NPC. `handle.done()` = playout di room SELESAI —
        # satu-satunya sinyal "masih bersuara" yang akurat (lihat `_wait_voices_idle`).
        self._handles: dict[str, Any] = {}
        # Detik audio NPC saat gilirannya dimulai → `on_npc_said` tahu apakah ucapan itu
        # benar-benar terdengar. Ucapan TANPA suara ditahan di `_unvoiced` (tak dicatat,
        # tak di-mirror) sampai diucapkan ulang.
        self._turn_audio_start: dict[str, float] = {}
        self._unvoiced: dict[str, str] = {}
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

    def npcs_answered_since_player(self) -> set[str]:
        """NPC yang sudah bicara sejak ucapan pemain terakhir."""
        answered: set[str] = set()
        for e in reversed(self._entries):
            if e.is_player:
                break
            answered.add(e.key)
        return answered

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
        if self._turn_was_silent(key):
            # Pemain tak mendengar apa pun → JANGAN masuk transkrip / konteks NPC lain
            # (dulu Sri menanggapi ucapan Darma yang tak pernah terdengar).
            logger.warning("%s: ucapan tanpa suara ditahan (tak dicatat/di-mirror): %s",
                           key, text)
            self._unvoiced[key] = text
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
        dibungkus `asyncio.shield`, jadi membatalkan rantai saja tak menghentikan suara.

        `force=True`: pemain bicara → NPC WAJIB diam. Dipanggil di tiap INTERIM berteks,
        jadi hanya bertindak (dan mencatat log) bila memang ada yang perlu dihentikan."""
        chain_alive = self._chain is not None and not self._chain.done()
        speaking = self._voices_active()
        if not chain_alive and not speaking:
            return
        logger.info("pemain bicara → NPC dihentikan (rantai aktif=%s, bersuara=%s)",
                    chain_alive, speaking or "-")
        self._cancel_chain()
        self._interrupt_all(force=True)

    async def on_user_said(self, text: str) -> None:
        text = text.strip()
        if self._closed or not text:
            return
        # Jalur teks (RPC send_text) tak melewati barge-in Listener, dan INTERIM bisa saja
        # tak terkirim — jadi giliran pemain SELALU menghentikan suara NPC juga, bukan
        # hanya rantainya. Tanpa ini NPC lama tetap bicara sementara NPC baru mulai.
        self.on_user_started()
        self._exchanges = 0
        self._append(None, PLAYER_NAME, text)

        # Pola kode latihan: SETIAP giliran pemain diputuskan direktur — juga saat nama NPC
        # disebut (direktur membedakan yang diajak bicara dari yang dibicarakan). Mirror dan
        # direktur tak saling bergantung, jadi dijalankan bersamaan.
        mirror = asyncio.ensure_future(self._mirror(PLAYER_NAME, text, list(self.agents)))
        decide = asyncio.ensure_future(
            director.decide(
                self._director_client,
                self._director_model,
                personas=self._rat.personas,
                transcript_tail=self.transcript_tail(),
                after_npc_turn=False,
                last_speaker=None,
                fallback=self.phase.default_persona,
                timeout=self._director_timeout,
            )
        )
        try:
            speaker = await decide
            await mirror  # konteks WAJIB sudah masuk sebelum NPC diminta bicara
        except asyncio.CancelledError:
            mirror.cancel()
            decide.cancel()
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

    def _voices_active(self) -> list[str]:
        """NPC yang suaranya MASIH diputar (handle belum selesai)."""
        return [k for k, h in self._handles.items() if not h.done()]

    async def _wait_voices_idle(self) -> None:
        """Satu suara pada satu waktu (pola kode latihan): giliran baru tak boleh mulai
        selagi NPC lain masih bersuara — sisa suaranya dihentikan dan ditunggu dulu.

        `Floor` saja tak cukup: lantai dilepas saat Gemini selesai MENGHASILKAN audio,
        padahal playout di room masih berjalan beberapa detik; handle baru selesai
        setelah playout selesai."""
        speaking = self._voices_active()
        if not speaking:
            return
        logger.info("menunggu suara %s berhenti sebelum giliran baru", speaking)
        stops = self._interrupt_all(force=True)
        try:
            await asyncio.wait_for(
                asyncio.gather(*stops, return_exceptions=True), VOICE_STOP_TIMEOUT
            )
        except TimeoutError:
            logger.warning("suara %s belum berhenti setelah %.1fs", speaking, VOICE_STOP_TIMEOUT)

    def _turn_was_silent(self, key: str) -> bool:
        """True bila giliran `key` yang sedang berjalan belum mengeluarkan audio sama sekali.
        Agent yang tak melacak audio (objek palsu di tes) dianggap bersuara."""
        start = self._turn_audio_start.get(key)
        now = self._spoken_audio(key)
        return start is not None and now is not None and now - start <= 0

    def _spoken_audio(self, key: str) -> float | None:
        """Total detik audio NPC `key` (None bila agent tak melacaknya, mis. objek palsu)."""
        return getattr(self.agents.get(key), "spoken_audio_s", None)

    def _log_turn(self, key: str, duration: float, audio_before: float | None) -> None:
        """Diagnosis: bedakan "NPC tak dipilih" dari "NPC dipilih tapi tak bersuara" —
        teks giliran tanpa suara tetap masuk transkrip walau pemain tak mendengar apa pun."""
        after = self._spoken_audio(key)
        if audio_before is None or after is None:
            return
        audio = after - audio_before
        logger.info("giliran %s selesai (%.1f dtk, audio %.1f dtk)", key, duration, audio)
        if audio <= 0:
            logger.warning("giliran %s selesai TANPA suara (%.1f dtk)", key, duration)

    def start_chain(self, speaker: str, *, instructions: str | None = None) -> None:
        """Mulai rantai giliran dari `speaker`. `instructions` = giliran TERJADWAL
        (sapaan, interupsi fase): berdiri SENDIRI lalu giliran kembali ke pemain, seperti
        sapaan `on_enter` di kode latihan — direktur tak dipanggil sesudahnya. Tanpa
        `instructions`, direktur memilih penyambung setelah tiap giliran."""
        self._cancel_chain()
        if instructions:
            self._exchanges = 0
        self._chain = self._tasks.spawn(
            self._run_chain(speaker, instructions), name=f"chain-{speaker}"
        )

    async def _speak(self, speaker: str, instructions: str | None) -> bool:
        """Satu `generate_reply` + tunggu playout. False bila gagal (rantai berhenti)."""
        session = self.sessions[speaker]
        audio_before = self._spoken_audio(speaker)
        if audio_before is not None:
            self._turn_audio_start[speaker] = audio_before
        started = time.monotonic()
        try:
            handle = (
                session.generate_reply(instructions=instructions)
                if instructions
                else session.generate_reply()
            )
        except RuntimeError:  # F4: sesi tak berjalan → berhenti, jangan crash
            logger.warning("generate_reply %s gagal dimulai", speaker, exc_info=True)
            return False
        self._handles[speaker] = handle
        await handle  # menunggu PLAYOUT selesai; tak pernah raise (I4)
        self._log_turn(speaker, time.monotonic() - started, audio_before)
        if handle.exception() is not None:
            logger.warning("generate_reply %s gagal: %s", speaker, handle.exception())
            return False
        return True

    async def _run_chain(self, speaker: str, instructions: str | None) -> None:
        limit = self._max_exchanges
        scheduled = instructions is not None
        try:
            while True:
                self._exchanges += 1
                logger.info("giliran -> %s (pertukaran %d/%d)", speaker, self._exchanges, limit)
                await self._wait_voices_idle()  # dulu: sisa ucapan terpotong ikut di-mirror
                await self._drain_mirrors()
                await self._publisher.speaker(self._rat.persona(speaker).name)
                if not await self._speak(speaker, instructions):
                    return
                instructions = None
                if (unvoiced := self._unvoiced.pop(speaker, None)) is not None:
                    logger.warning("%s: Gemini menjawab tanpa audio → ucapkan ulang sekali", speaker)
                    if not await self._speak(speaker, REVOICE_INSTRUCTIONS.format(text=unvoiced)):
                        return
                    if self._unvoiced.pop(speaker, None) is not None:
                        logger.error("%s: ucapan ulang tetap tanpa audio — dibuang", speaker)
                        return
                if scheduled:
                    logger.info("giliran terjadwal %s selesai, giliran ke pemain", speaker)
                    return
                if self._exchanges >= limit:  # F4: tak memanggil direktur yang hasilnya dibuang
                    logger.info("batas %d pertukaran tercapai, giliran balik ke pemain", limit)
                    return
                await asyncio.sleep(self._settle_delay)  # biar ucapan masuk transkrip
                nxt = await director.decide(
                    self._director_client,
                    self._director_model,
                    personas=self._rat.personas,
                    transcript_tail=self.transcript_tail(),
                    after_npc_turn=True,
                    last_speaker=speaker,
                    fallback=director.WAIT_FOR_USER,
                    timeout=self._director_timeout,
                    npc_turns=self._exchanges,
                    max_rebuttals=self._max_rebuttals,
                    answered=self.npcs_answered_since_player(),
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
