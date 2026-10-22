"""Discussion RAT dengan objek palsu (spec §9): rantai giliran, barge-in, mirror, F1, fase.

Sesi palsu meniru `SpeechHandle`: `await handle` = `asyncio.shield(done_future)` dan tak
pernah raise; kegagalan lewat `handle.exception()`.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from livekit.agents import llm
from rat import director
from rat.director import WAIT_FOR_USER
from rat.discussion import PLAYER_NAME, Discussion
from rat.floor import Floor
from runtime.tasks import BackgroundTasks
from scenarios import get_scenario

RAT = get_scenario("rapat-anggota-tahunan").rat
MAX_EXCHANGES = 4  # = MAX_NPC_EXCHANGES kode latihan


class FakeHandle:
    def __init__(self, auto_done: bool = True) -> None:
        self._fut: asyncio.Future = asyncio.get_running_loop().create_future()
        if auto_done:
            self._fut.set_result(None)

    def finish(self) -> None:
        if not self._fut.done():
            self._fut.set_result(None)

    def done(self) -> bool:
        return self._fut.done()

    def exception(self) -> BaseException | None:
        return None

    def __await__(self):
        return asyncio.shield(self._fut).__await__()


class FakeSession:
    def __init__(self, key: str, log: list, *, auto_done: bool = True) -> None:
        self.key = key
        self.log = log
        self.auto_done = auto_done
        self.handles: list[FakeHandle] = []
        self.interrupts = 0

    def generate_reply(self, **kwargs: Any) -> FakeHandle:
        self.log.append((self.key, kwargs.get("instructions")))
        h = FakeHandle(self.auto_done)
        self.handles.append(h)
        return h

    def interrupt(self, *, force: bool = False) -> asyncio.Future:
        self.interrupts += 1
        for h in self.handles:
            h.finish()  # suara berhenti → playout selesai
        fut = asyncio.get_running_loop().create_future()
        fut.set_result(None)
        return fut


class FakeAgent:
    def __init__(self) -> None:
        self.chat_ctx = llm.ChatContext.empty()
        self.instructions: list[str] = []

    async def update_chat_ctx(self, ctx: llm.ChatContext) -> None:
        self.chat_ctx = ctx

    async def update_instructions(self, text: str) -> None:
        self.instructions.append(text)


class FakePublisher:
    def __init__(self) -> None:
        self.speakers: list[str] = []
        self.phases: list[int] = []

    async def speaker(self, name: str) -> None:
        self.speakers.append(name)

    async def phase(self, phase_id: int, label: str, advance: str | None) -> None:
        self.phases.append(phase_id)


def _build(*, auto_done: bool = True):
    log: list = []
    pub = FakePublisher()
    d = Discussion(
        rat=RAT,
        floor=Floor(),
        publisher=pub,
        tasks=BackgroundTasks(),
        director_client=None,
        director_model="m",
        director_timeout=1.0,
        settle_delay=0,
        max_npc_exchanges=MAX_EXCHANGES,
        max_npc_rebuttals=1,
    )
    sessions = {}
    agents = {}
    for p in RAT.personas:
        sessions[p.key] = FakeSession(p.key, log, auto_done=auto_done)
        agents[p.key] = FakeAgent()
        d.register(p.key, agents[p.key], sessions[p.key])
    return d, sessions, agents, log, pub


def _script_director(monkeypatch, answers: list[str]) -> list[dict]:
    calls: list[dict] = []

    async def _decide(client, model, **kw):
        calls.append(kw)
        return answers.pop(0) if answers else kw["fallback"]

    monkeypatch.setattr(director, "decide", _decide)
    return calls


async def _settle(d: Discussion) -> None:
    for _ in range(20):
        await asyncio.sleep(0)
    if d._chain is not None:
        await asyncio.wait({d._chain}, timeout=1)


def _texts(agent: FakeAgent) -> list[str]:
    return [m.text_content for m in agent.chat_ctx.messages()]


def test_player_turn_always_asks_director_and_mirrors_to_both(monkeypatch):
    # Pola kode latihan: nama disebut pun tetap diputuskan direktur (tanpa pintasan nama).
    calls = _script_director(monkeypatch, ["darma", WAIT_FOR_USER])

    async def go():
        d, _, agents, log, pub = _build()
        await d.on_user_said("Pak Darma, tolong tenang.")
        await _settle(d)
        return d, agents, log, pub

    d, agents, log, pub = asyncio.run(go())
    assert calls[0]["after_npc_turn"] is False
    assert calls[0]["fallback"] == RAT.phases[0].default_persona
    assert log[0] == ("darma", None)
    assert pub.speakers[0] == "Pak Darma"
    # I7: format mirror "[Nama berbicara] ...", role user, ke KEDUA NPC.
    for key in ("darma", "sri"):
        assert _texts(agents[key]) == [f"[{PLAYER_NAME} berbicara] Pak Darma, tolong tenang."]
    assert d.transcript_tail() == [f"{PLAYER_NAME}: Pak Darma, tolong tenang."]


def test_addressed_npc_follows_after_other_npc(monkeypatch):
    # Aturan PERTAMA: pemain menyapa keduanya, direktur memilih Sri dulu, lalu Darma —
    # yang disebut tapi belum menyahut — menyusul sebelum giliran balik ke pemain.
    calls = _script_director(monkeypatch, ["sri", "darma", WAIT_FOR_USER])

    async def go():
        d, _, _, log, _ = _build()
        await d.on_user_said("Ibu Sri dan Pak Darma, apakah kita bisa mulai?")
        await _settle(d)
        return log

    log = asyncio.run(go())
    assert [k for k, _ in log] == ["sri", "darma"]
    assert [c["after_npc_turn"] for c in calls] == [False, True, True]
    assert calls[1]["last_speaker"] == "sri"
    # Direktur diberi posisi di rantai + siapa yang sudah menyahut (dasar guard alasan).
    assert calls[1]["npc_turns"] == 1 and calls[1]["max_rebuttals"] == 1


def test_turn_without_audio_is_logged(monkeypatch, caplog):
    # Diagnosis: giliran yang selesai tanpa satu frame audio pun diberi peringatan.
    _script_director(monkeypatch, ["darma", WAIT_FOR_USER])

    async def go():
        d, _, agents, _, _ = _build()
        for a in agents.values():
            a.spoken_audio_s = 0.0  # meniru NpcAgent; FakeSession tak pernah bersuara
        await d.on_user_said("Pak Darma, silakan.")
        await _settle(d)

    with caplog.at_level("INFO", logger="koperasi.rat.discussion"):
        asyncio.run(go())
    assert "giliran darma selesai TANPA suara" in caplog.text


def test_chain_npc_rebuttal_then_wait(monkeypatch):
    _script_director(monkeypatch, ["sri", "darma", WAIT_FOR_USER])

    async def go():
        d, _, _, log, _ = _build()
        await d.on_user_said("Saya buka rapatnya.")
        await _settle(d)
        return log

    log = asyncio.run(go())
    # pemain → sri → (direktur) darma → (direktur) tunggu_user
    assert [k for k, _ in log] == ["sri", "darma"]


def test_chain_respects_exchange_limit(monkeypatch):
    calls = _script_director(monkeypatch, ["sri"] + ["darma", "sri"] * 5)

    async def go():
        d, _, _, log, _ = _build()
        await d.on_user_said("Saya buka rapatnya.")
        await _settle(d)
        return log

    log = asyncio.run(go())
    assert len(log) == MAX_EXCHANGES
    # F4: setelah giliran ke-limit, direktur TIDAK dipanggil lagi.
    assert sum(1 for c in calls if c["after_npc_turn"]) == MAX_EXCHANGES - 1


def test_exchange_limit_resets_on_each_player_turn(monkeypatch):
    # Pola kode latihan: jatah pertukaran dihitung ulang dari 0 setiap pemain bicara.
    _script_director(monkeypatch, ["sri"] + ["darma", "sri"] * 2 + ["darma"] + ["sri", "darma"] * 2)

    async def go():
        d, _, _, log, _ = _build()
        await d.on_user_said("Saya buka rapatnya.")
        await _settle(d)
        first = len(log)
        await d.on_user_said("Lanjut ke agenda berikutnya.")
        await _settle(d)
        return first, len(log)

    first, total = asyncio.run(go())
    assert first == MAX_EXCHANGES
    assert total == 2 * MAX_EXCHANGES


def test_exchange_limit_not_refilled_by_barge_in_alone(monkeypatch):
    # Barge-in tanpa ucapan baru (mis. derau) tak memberi jatah baru ke rantai berikutnya.
    _script_director(monkeypatch, ["darma"] * 10)

    async def go():
        d, _, _, log, _ = _build()
        d._exchanges = MAX_EXCHANGES - 1
        d.start_chain("sri")
        await _settle(d)
        return log

    assert [k for k, _ in asyncio.run(go())] == ["sri"]


def test_barge_in_cancels_chain_and_interrupts_all(monkeypatch):
    _script_director(monkeypatch, ["sri"])

    async def go():
        d, sessions, _, _, _ = _build(auto_done=False)  # NPC "masih bicara"
        await d.on_user_said("Halo forum.")
        await asyncio.sleep(0.01)
        chain = d._chain
        assert chain is not None and not chain.done()
        d.on_user_started()
        await asyncio.sleep(0.01)
        return chain, sessions

    chain, sessions = asyncio.run(go())
    assert chain.cancelled()
    assert all(s.interrupts >= 1 for s in sessions.values())  # I5: SEMUA sesi


def test_player_turn_stops_speaking_npc_before_next_npc(monkeypatch):
    # Jalur teks (tanpa on_user_started): Sri masih bersuara saat pemain memanggil Darma.
    # Sri WAJIB dihentikan dan suaranya selesai SEBELUM Darma mulai — tak boleh tumpang tindih.
    _script_director(monkeypatch, ["darma"])
    sri_done_when_darma_starts: list[bool] = []

    async def go():
        d, sessions, _, log, _ = _build(auto_done=False)
        orig = sessions["darma"].generate_reply

        def _gen(**kw):
            sri_done_when_darma_starts.append(sessions["sri"].handles[-1].done())
            return orig(**kw)

        sessions["darma"].generate_reply = _gen
        d.start_chain("sri")
        await asyncio.sleep(0.01)
        assert d._voices_active() == ["sri"]
        await d.on_user_said("Pak Darma, bagaimana kabar Anda?")
        await asyncio.sleep(0.01)
        d._cancel_chain()
        return sessions, log

    sessions, log = asyncio.run(go())
    assert [k for k, _ in log] == ["sri", "darma"]
    assert sessions["sri"].interrupts >= 1
    assert sri_done_when_darma_starts == [True]


def _silent_darma(d, sessions, agents, *, voiced_on_revoice: bool):
    """Darma meniru Gemini yang menjawab TANPA audio (hanya transkrip). Ucapan ulang
    (generate_reply ber-instructions) bersuara bila `voiced_on_revoice`."""
    for a in agents.values():
        a.spoken_audio_s = 0.0
    orig = sessions["darma"].generate_reply

    def _gen(**kw):
        h = orig(**kw)
        if kw.get("instructions") and voiced_on_revoice:
            agents["darma"].spoken_audio_s += 3.0
        d.on_npc_said("darma", "Saya tidak setuju!")
        return h

    sessions["darma"].generate_reply = _gen


def test_unvoiced_npc_line_is_held_back_then_revoiced(monkeypatch):
    _script_director(monkeypatch, [WAIT_FOR_USER])

    async def go():
        d, sessions, agents, log, _ = _build()
        _silent_darma(d, sessions, agents, voiced_on_revoice=True)
        d.start_chain("darma")
        await _settle(d)
        return d, agents, log

    d, agents, log = asyncio.run(go())
    # Giliran senyap → diucapkan ulang PERSIS dengan teks yang sama.
    assert [k for k, _ in log] == ["darma", "darma"]
    assert log[0][1] is None and "Saya tidak setuju!" in log[1][1]
    # Dicatat & di-mirror SEKALI — hanya versi yang benar-benar terdengar.
    assert d.transcript_tail() == ["Pak Darma: Saya tidak setuju!"]
    assert _texts(agents["sri"]) == ["[Pak Darma berbicara] Saya tidak setuju!"]


def test_unvoiced_twice_is_dropped_and_never_mirrored(monkeypatch):
    calls = _script_director(monkeypatch, ["sri"])

    async def go():
        d, sessions, agents, log, _ = _build()
        _silent_darma(d, sessions, agents, voiced_on_revoice=False)
        d.start_chain("darma")
        await _settle(d)
        return d, agents, log

    d, agents, log = asyncio.run(go())
    assert [k for k, _ in log] == ["darma", "darma"]  # ulang hanya sekali
    assert d.transcript_tail() == []  # pemain tak mendengar apa pun → tak ada yang dicatat
    assert _texts(agents["sri"]) == []  # Sri tak "mendengar" ucapan yang tak terdengar
    assert calls == []  # rantai berhenti, giliran ke pemain


def test_scheduled_turn_stands_alone(monkeypatch):
    # Seperti sapaan `on_enter` kode latihan: giliran terjadwal tak diikuti direktur.
    calls = _script_director(monkeypatch, ["darma"])

    async def go():
        d, _, _, log, _ = _build()
        d.start_chain("sri", instructions="Sapa pimpinan.")
        await _settle(d)
        return log

    assert [k for k, _ in asyncio.run(go())] == ["sri"]
    assert calls == []


def test_barge_in_while_idle_does_not_interrupt():
    # INTERIM datang terus selama pemain bicara; saat tak ada yang bersuara, jangan
    # mengirim interrupt ke Gemini berulang-ulang.
    async def go():
        d, sessions, _, _, _ = _build()
        d.on_user_started()
        return sessions

    assert all(s.interrupts == 0 for s in asyncio.run(go()).values())


def test_npc_said_strips_fake_prefix_and_mirrors_to_other(monkeypatch):
    # F1: Darma menulis "Ibu Sri: ..." → tetap dicatat sebagai Darma, awalan dibuang,
    # dan dicerminkan ke Sri (bukan ke Darma sendiri).
    async def go():
        d, _, agents, _, _ = _build()
        d.on_npc_said("darma", "Ibu Sri: saya setuju beras lokal.")
        await asyncio.sleep(0.01)
        return d, agents

    d, agents = asyncio.run(go())
    assert d.transcript_tail() == ["Pak Darma: saya setuju beras lokal."]
    assert _texts(agents["sri"]) == ["[Pak Darma berbicara] saya setuju beras lokal."]
    assert _texts(agents["darma"]) == []


def test_evaluation_transcript_keeps_persona_names():
    async def go():
        d, _, _, _, _ = _build()
        d._append(None, PLAYER_NAME, "Rapat dibuka.")
        d.on_npc_said("sri", "Kuorum terpenuhi, Pimpinan.")
        return d.evaluation_transcript()

    assert asyncio.run(go()) == [("user", "Rapat dibuka."), ("Ibu Sri", "Kuorum terpenuhi, Pimpinan.")]


def test_transcript_listener_sees_player_entry_before_director(monkeypatch):
    seen: list = []

    async def _decide(client, model, **kw):
        seen.append(("director", list(kw["transcript_tail"])))
        return "sri"

    monkeypatch.setattr(director, "decide", _decide)

    async def go():
        d, _, _, _, _ = _build()
        d.add_transcript_listener(lambda e: seen.append(("listener", e.text, e.is_player)))
        await d.on_user_said("Mari kita mulai.")
        d._cancel_chain()

    asyncio.run(go())
    assert seen[0] == ("listener", "Mari kita mulai.", True)
    # I6: direktur melihat ucapan terbaru.
    assert seen[1][1][-1] == f"{PLAYER_NAME}: Mari kita mulai."


def test_advance_phase_updates_both_and_runs_scripted_interruption(monkeypatch):
    _script_director(monkeypatch, [WAIT_FOR_USER])

    async def go():
        d, _, agents, log, pub = _build()
        ok = await d.advance_phase()
        await _settle(d)
        return ok, d, agents, log, pub

    ok, d, agents, log, pub = asyncio.run(go())
    assert ok and d.phase.id == 2 and pub.phases == [2]
    for a in agents.values():
        assert "Fase 2 — Baca LPJ" in a.instructions[-1]
    persona_key, line = RAT.phases[1].entry_line
    assert log[0][0] == persona_key and line in log[0][1]


def test_advance_phase_noop_at_last_phase_and_after_close(monkeypatch):
    _script_director(monkeypatch, [])

    async def go():
        d, _, _, _, _ = _build()
        results = [await d.advance_phase() for _ in range(len(RAT.phases) + 1)]
        d2, _, _, _, _ = _build()
        await d2.close()
        return results, await d2.advance_phase()

    results, after_close = asyncio.run(go())
    assert results == [True, True, False, False]
    assert after_close is False


def test_closed_discussion_ignores_player(monkeypatch):
    calls = _script_director(monkeypatch, ["sri"])

    async def go():
        d, _, _, log, _ = _build()
        await d.close()
        await d.on_user_said("Halo?")
        return log

    assert asyncio.run(go()) == []
    assert calls == []


@pytest.mark.parametrize("text", ["", "   "])
def test_empty_player_text_ignored(monkeypatch, text):
    calls = _script_director(monkeypatch, ["sri"])

    async def go():
        d, _, _, log, _ = _build()
        await d.on_user_said(text)
        return log

    assert asyncio.run(go()) == [] and calls == []


def test_next_npc_sees_previous_npc_line_before_speaking(monkeypatch):
    # Mirror ucapan Sri ke Darma WAJIB selesai sebelum Darma diminta bicara.
    _script_director(monkeypatch, [WAIT_FOR_USER])
    seen_by_darma: list[list[str]] = []

    async def go():
        d, sessions, agents, _, _ = _build()

        async def _slow_update(ctx):  # mirror lambat
            await asyncio.sleep(0.05)
            agents["darma"].chat_ctx = ctx

        agents["darma"].update_chat_ctx = _slow_update
        orig = sessions["darma"].generate_reply

        def _gen(**kw):
            seen_by_darma.append(_texts(agents["darma"]))
            return orig(**kw)

        sessions["darma"].generate_reply = _gen
        d.on_npc_said("sri", "Kuorum sudah terpenuhi.")
        d.start_chain("darma")
        await _settle(d)

    asyncio.run(go())
    assert seen_by_darma == [["[Ibu Sri berbicara] Kuorum sudah terpenuhi."]]
