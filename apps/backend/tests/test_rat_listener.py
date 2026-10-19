"""Listener RAT: debounce potongan FINAL, barge-in INTERIM, proteksi echo, filter NPC (I2)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from livekit import rtc
from livekit.agents import stt as stt_api
from rat.listener import Listener
from runtime.tasks import BackgroundTasks


class _Out:
    def __init__(self) -> None:
        self.published: list[tuple[str, bool]] = []

    async def publish(self, text: str, *, final: bool) -> None:
        self.published.append((text, final))


def _ev(kind: stt_api.SpeechEventType, text: str) -> stt_api.SpeechEvent:
    return stt_api.SpeechEvent(type=kind, alternatives=[stt_api.SpeechData(language="id", text=text)])


def _listener(*, npc_speaking=lambda: False, budget=3.0, debounce=0.05):
    said: list[str] = []
    started: list[int] = []

    async def _on_utterance(text: str) -> None:
        said.append(text)

    room = SimpleNamespace(on=lambda *a: None, remote_participants={})
    lst = Listener(
        room=room,
        stt=None,
        ignore_identities={"npc-pak-darma", "npc-ibu-sri"},
        npc_speaking=npc_speaking,
        on_speech_started=lambda: started.append(1),
        on_utterance=_on_utterance,
        tasks=BackgroundTasks(),
        debounce=debounce,
        echo_guard_budget=budget,
    )
    return lst, said, started


def test_final_pieces_are_merged_into_one_turn():
    async def go():
        lst, said, _ = _listener()
        out = _Out()
        await lst._handle_event(_ev(stt_api.SpeechEventType.FINAL_TRANSCRIPT, "saya mau"), out)
        await asyncio.sleep(0.01)
        await lst._handle_event(_ev(stt_api.SpeechEventType.FINAL_TRANSCRIPT, "buka rapat"), out)
        await asyncio.sleep(0.15)
        return said, out

    said, out = asyncio.run(go())
    assert said == ["saya mau buka rapat"]
    assert out.published == [("saya mau", True), ("buka rapat", True)]


def test_interim_triggers_barge_in_and_holds_flush_without_dropping_pieces():
    async def go():
        lst, said, started = _listener()
        out = _Out()
        await lst._handle_event(_ev(stt_api.SpeechEventType.FINAL_TRANSCRIPT, "pak darma"), out)
        await lst._handle_event(_ev(stt_api.SpeechEventType.INTERIM_TRANSCRIPT, "tolong"), out)
        await asyncio.sleep(0.1)  # timer dibatalkan → belum ada giliran
        early = list(said)
        await lst._handle_event(_ev(stt_api.SpeechEventType.FINAL_TRANSCRIPT, "tenang"), out)
        await asyncio.sleep(0.15)
        return early, said, started

    early, said, started = asyncio.run(go())
    assert early == []
    assert said == ["pak darma tenang"]
    assert started == [1]


def test_empty_events_ignored():
    async def go():
        lst, said, started = _listener()
        out = _Out()
        await lst._handle_event(_ev(stt_api.SpeechEventType.INTERIM_TRANSCRIPT, "  "), out)
        await lst._handle_event(_ev(stt_api.SpeechEventType.FINAL_TRANSCRIPT, ""), out)
        await asyncio.sleep(0.1)
        return said, started, out

    said, started, out = asyncio.run(go())
    assert said == [] and started == [] and out.published == []


def _frame(ms: int = 100) -> rtc.AudioFrame:
    n = 16000 * ms // 1000
    return rtc.AudioFrame(b"\x01\x00" * n, sample_rate=16000, num_channels=1, samples_per_channel=n)


def test_echo_guard_silences_only_while_npc_speaks_and_budget_is_one_shot():
    speaking = {"v": True}
    lst, _, _ = _listener(npc_speaking=lambda: speaking["v"], budget=0.25)

    silenced = [bytes(lst._guard_echo(_frame()).data) == b"\x00" * 3200 for _ in range(4)]
    # 0.25 dtk jatah, frame 0.1 dtk → 3 frame dibisukan, sisanya lolos.
    assert silenced == [True, True, True, False]
    speaking["v"] = False
    lst2, _, _ = _listener(npc_speaking=lambda: speaking["v"], budget=0.25)
    assert bytes(lst2._guard_echo(_frame()).data) != b"\x00" * 3200  # NPC diam → asli


def test_npc_tracks_are_never_listened_to():
    lst, _, _ = _listener()
    spawned: list[str] = []
    lst._tasks = SimpleNamespace(spawn=lambda coro, name: (coro.close(), spawned.append(name)))
    audio = SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO)
    video = SimpleNamespace(kind=rtc.TrackKind.KIND_VIDEO)
    pub = SimpleNamespace(sid="TR_1")
    lst._on_track_subscribed(audio, pub, SimpleNamespace(identity="npc-pak-darma"))
    lst._on_track_subscribed(video, pub, SimpleNamespace(identity="player-1"))
    assert spawned == []
