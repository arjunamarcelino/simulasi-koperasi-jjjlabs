"""Telinga RAT: STT murni pada mic pemain — tanpa LLM, tak pernah menjawab (I2).

Tugasnya hanya:
- mengubah suara pemain jadi teks lalu memberi `on_utterance(teks)` per giliran
  (potongan FINAL digabung dulu selama jeda — debounce),
- memberi sinyal barge-in `on_speech_started()` saat KATA benar-benar terdengar
  (INTERIM berteks, bukan START_OF_SPEECH yang mudah terpicu derau/echo),
- membisukan echo suara NPC ke STT selama jatah proteksi masih ada,
- mem-publish transkripsi pemain ke room. Sesi NPC ber-`audio_input=False`, jadi tak ada
  lagi yang mentranskrip pemain untuk FE — tanpa ini ucapan pemain hilang dari layar.

Bahasa dikunci `id-ID` DAN `detect_language=False` (default plugin = True): transkrip yang
meleset ke Korea/Jepang membuat direktur salah pilih NPC.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable, Iterable

from livekit import rtc
from livekit.agents import APIStatusError, utils
from livekit.agents import stt as stt_api
from livekit.plugins import google

from runtime.tasks import BackgroundTasks

logger = logging.getLogger("koperasi.rat.listener")


def make_stt(language: str) -> google.STT:
    """Dibuat SEBELUM sesi NPC start (F8): tanpa ADC konstruktor melempar ValueError —
    lebih baik gagal di awal job daripada setelah NPC menyapa."""
    return google.STT(
        languages=[language],
        detect_language=False,
        interim_results=True,
        enable_voice_activity_events=True,
        punctuate=True,
    )


class _PlayerTranscription:
    """Publikasi transkripsi pemain dengan API transkripsi rtc (yang dibaca FE lewat
    `RoomEvent.TranscriptionReceived`), atas nama identity & track mic pemain."""

    def __init__(self, room: rtc.Room, identity: str, track_sid: str) -> None:
        self._room = room
        self._identity = identity
        self._track_sid = track_sid
        self._segment_id = utils.shortuuid("SG_")

    async def publish(self, text: str, *, final: bool) -> None:
        segment = rtc.TranscriptionSegment(
            id=self._segment_id, text=text, start_time=0, end_time=0, final=final, language=""
        )
        if final:
            self._segment_id = utils.shortuuid("SG_")
        try:
            if self._room.isconnected():
                await self._room.local_participant.publish_transcription(
                    rtc.Transcription(
                        participant_identity=self._identity,
                        track_sid=self._track_sid,
                        segments=[segment],
                    )
                )
        except Exception:  # noqa: BLE001 — tampilan transkrip tak boleh mematikan telinga
            logger.debug("gagal publish transkripsi pemain", exc_info=True)


class Listener:
    def __init__(
        self,
        *,
        room: rtc.Room,
        stt: google.STT,
        ignore_identities: Iterable[str],
        npc_speaking: Callable[[], bool],
        on_speech_started: Callable[[], None],
        on_utterance: Callable[[str], Awaitable[None]],
        tasks: BackgroundTasks,
        debounce: float,
        echo_guard_budget: float,
    ) -> None:
        self._room = room
        self._stt = stt
        self._ignore = set(ignore_identities)
        self._npc_speaking = npc_speaking
        self._on_speech_started = on_speech_started
        self._on_utterance = on_utterance
        self._tasks = tasks
        self._debounce = debounce
        # Sisa detik audio yang dibisukan saat NPC bicara. Sekali pakai seumur sesi:
        # meniru warm-up AEC framework (3 dtk), sesudahnya andalkan AEC klien.
        self._echo_budget = echo_guard_budget
        self._pending: list[str] = []
        self._flush_task: asyncio.Task | None = None
        self._listen_tasks: set[asyncio.Task] = set()

    def start(self) -> None:
        self._room.on("track_subscribed", self._on_track_subscribed)
        # Track yang sudah terlanjur ada sebelum listener dipasang.
        for participant in self._room.remote_participants.values():
            for pub in participant.track_publications.values():
                if pub.track is not None:
                    self._on_track_subscribed(pub.track, pub, participant)

    def _on_track_subscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        # JANGAN dengarkan NPC: suaranya akan dikira pemain → percakapan berputar sendiri.
        if participant.identity in self._ignore:
            logger.info("lewati track milik NPC: %s", participant.identity)
            return
        logger.info("mulai mendengarkan %s", participant.identity)
        out = _PlayerTranscription(self._room, participant.identity, publication.sid)
        task = self._tasks.spawn(self._listen(track, out), name=f"listen-{participant.identity}")
        self._listen_tasks.add(task)
        task.add_done_callback(self._listen_tasks.discard)

    def _guard_echo(self, frame: rtc.AudioFrame) -> rtc.AudioFrame:
        """Selama jatah ada DAN NPC bicara → kirim keheningan ke STT."""
        if self._echo_budget > 0 and self._npc_speaking():
            self._echo_budget -= frame.duration
            if self._echo_budget <= 0:
                logger.info("jatah proteksi echo habis, barge-in aktif sepenuhnya")
            return utils.audio.silence_frame_like(frame)
        return frame

    async def _listen(self, track: rtc.Track, out: _PlayerTranscription) -> None:
        audio_stream = rtc.AudioStream(track)
        stt_stream = self._stt.stream()

        async def _pump() -> None:
            async for ev in audio_stream:
                stt_stream.push_frame(self._guard_echo(ev.frame))
            stt_stream.end_input()

        pump_task = asyncio.create_task(_pump())
        try:
            async for ev in stt_stream:
                await self._handle_event(ev, out)
        except APIStatusError as e:
            if e.status_code == 403:
                logger.error(
                    "Cloud Speech-to-Text API belum aktif di project GCP ini — aktifkan "
                    "speech.googleapis.com lalu jalankan ulang. Tanpa itu NPC tak pernah "
                    "mendengar pemain."
                )
            else:
                logger.error("STT gagal (%s): %s", e.status_code, e.message)
        except Exception:
            logger.exception("pendengar berhenti karena error tak terduga")
        finally:
            pump_task.cancel()
            with contextlib.suppress(Exception):
                await stt_stream.aclose()
            with contextlib.suppress(Exception):
                await audio_stream.aclose()

    async def _handle_event(self, ev: stt_api.SpeechEvent, out: _PlayerTranscription) -> None:
        text = ev.alternatives[0].text.strip() if ev.alternatives else ""
        if not text:
            return
        if ev.type == stt_api.SpeechEventType.INTERIM_TRANSCRIPT:
            self._on_speech_started()
            self._cancel_flush()  # pemain masih di tengah kalimat
            await out.publish(text, final=False)
        elif ev.type == stt_api.SpeechEventType.FINAL_TRANSCRIPT:
            await out.publish(text, final=True)
            self._on_final(text)

    # ---------- debounce potongan kalimat ----------

    def _cancel_flush(self) -> None:
        if self._flush_task is not None and not self._flush_task.done():
            self._flush_task.cancel()
        self._flush_task = None

    def _on_final(self, text: str) -> None:
        """STT memotong satu kalimat jadi beberapa FINAL di tiap jeda napas; tanpa
        penahan, potongan pertama memicu giliran NPC yang langsung dibatalkan."""
        self._pending.append(text)
        self._cancel_flush()
        self._flush_task = self._tasks.spawn(self._flush_after_pause(), name="listener-flush")

    async def _flush_after_pause(self) -> None:
        try:
            await asyncio.sleep(self._debounce)
        except asyncio.CancelledError:
            return  # ada lanjutan kalimat; biarkan terkumpul
        pieces, self._pending = self._pending, []
        sentence = " ".join(pieces).strip()
        if not sentence:
            return
        if len(pieces) > 1:
            logger.info("%d potongan digabung jadi satu giliran", len(pieces))
        await self._on_utterance(sentence)

    async def aclose(self) -> None:
        self._cancel_flush()
        self._room.off("track_subscribed", self._on_track_subscribed)
        for task in list(self._listen_tasks):
            task.cancel()
