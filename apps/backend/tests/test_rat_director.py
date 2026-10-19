"""Direktur RAT: pencocokan jawaban (F2) + guard keras I8 + fallback (error/timeout)."""

from __future__ import annotations

import asyncio

import pytest
from rat import director
from rat.director import (
    ATTACKED,
    CALLED,
    IMPORTANT,
    WAIT_FOR_USER,
    allow_followup,
    build_system_prompt,
    match_choice,
    parse_reason,
)
from scenarios import get_scenario

RAT = get_scenario("rapat-anggota-tahunan").rat


def _decide(client, *, after_npc_turn: bool, last_speaker=None, fallback="sri", timeout=1.0):
    return asyncio.run(
        director.decide(
            client,
            "model-director",
            personas=RAT.personas,
            transcript_tail=["Pimpinan: mari mulai"],
            after_npc_turn=after_npc_turn,
            last_speaker=last_speaker,
            fallback=fallback,
            timeout=timeout,
        )
    )


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("darma", "darma"),
        ("**Sri**.", "sri"),
        ("tunggu user", WAIT_FOR_USER),
        ("tunggu-user", WAIT_FOR_USER),
        ("darma atau sri", None),  # ambigu
        ("pak budi", None),
        ("", None),
    ],
)
def test_match_choice(raw, expected):
    assert match_choice(raw, ["darma", "sri", WAIT_FOR_USER]) == expected


def test_player_turn_picks_valid_answer(fake_gemini):
    assert _decide(fake_gemini("darma"), after_npc_turn=False) == "darma"


def test_player_turn_never_waits(fake_gemini):
    # (a) giliran pemain tak boleh dijawab tunggu_user — juga bukan pilihan valid di mode ini.
    assert _decide(fake_gemini(WAIT_FOR_USER), after_npc_turn=False, fallback="sri") == "sri"


def test_npc_turn_cannot_repeat_last_speaker(fake_gemini):
    # (b) NPC yang barusan bicara tak boleh dipilih lagi.
    got = _decide(
        fake_gemini("darma"), after_npc_turn=True, last_speaker="darma", fallback=WAIT_FOR_USER
    )
    assert got == WAIT_FOR_USER


def test_npc_turn_allows_rebuttal(fake_gemini):
    got = _decide(
        fake_gemini("sri"), after_npc_turn=True, last_speaker="darma", fallback=WAIT_FOR_USER
    )
    assert got == "sri"


def test_invalid_answer_falls_back(fake_gemini):
    assert _decide(fake_gemini("entahlah"), after_npc_turn=False, fallback="sri") == "sri"


def test_error_falls_back(fake_gemini):
    client = fake_gemini(raises=RuntimeError("boom"))
    assert _decide(client, after_npc_turn=True, fallback=WAIT_FOR_USER) == WAIT_FOR_USER


def test_timeout_falls_back():
    # F3: direktur macet → fallback, bukan keheningan tanpa batas.
    from types import SimpleNamespace

    async def _slow(**_):
        await asyncio.sleep(5)

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=_slow)))
    assert _decide(client, after_npc_turn=False, fallback="sri", timeout=0.05) == "sri"


def test_prompt_lists_only_valid_choices_without_phase_bias(fake_gemini):
    client = fake_gemini("sri")
    _decide(client, after_npc_turn=False)
    system = client.calls[0]["config"].system_instruction
    assert WAIT_FOR_USER not in system  # bukan pilihan pada giliran pemain
    # Pola kode latihan: roster + aturan saja, tanpa petunjuk fase yang memihak satu NPC.
    assert "paling relevan" not in system and "Fase" not in system
    assert "Pak Darma" in system and "Ibu Sri" in system


def test_player_turn_prompt_prefers_addressed_npc_over_mentioned():
    # Tanpa pintasan nama di kode: direktur yang membedakan diajak bicara vs dibicarakan.
    system, choices = build_system_prompt(
        RAT.personas, after_npc_turn=False, last_speaker=None
    )
    assert choices == ["darma", "sri"]
    assert "DIAJAK BICARA" in system


def test_npc_turn_prompt_asks_for_reason_and_allows_waiting():
    system, choices = build_system_prompt(
        RAT.personas, after_npc_turn=True, last_speaker="sri", npc_turns=2
    )
    assert choices == ["darma", "sri", WAIT_FOR_USER]
    assert "Ibu Sri (sri) BARU SAJA bicara" in system
    assert "sudah 2 giliran NPC" in system
    assert "TIDAK setiap ucapan perlu dibalas" in system
    for reason in (CALLED, ATTACKED, IMPORTANT):
        assert reason in system
    # Sekadar disebut nama oleh NPC lain bukan serangan (di RAT keduanya saling menyebut).
    assert "Sekadar disebut namanya bukan serangan" in system


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("darma diserang", ATTACKED),
        ("**sri** dipanggil", CALLED),
        ("darma penting.", IMPORTANT),
        ("darma", None),
        ("tunggu_user", None),
    ],
)
def test_parse_reason(raw, expected):
    assert parse_reason(raw) == expected


@pytest.mark.parametrize(
    "reason,npc_turns,max_rebuttals,allowed",
    [
        (CALLED, 3, 1, True),  # pimpinan menunggu jawabannya → selalu boleh
        (ATTACKED, 1, 1, True),  # satu sanggahan langsung
        (ATTACKED, 2, 1, False),  # sanggah-balas melebihi batas
        (ATTACKED, 2, 2, True),  # batas dinaikkan lewat env
        (IMPORTANT, 1, 1, True),  # hanya sebagai penyambung pertama
        (IMPORTANT, 2, 3, False),
    ],
)
def test_allow_followup(reason, npc_turns, max_rebuttals, allowed):
    assert allow_followup(reason, npc_turns=npc_turns, max_rebuttals=max_rebuttals) is allowed


def _decide_after_npc(client, *, npc_turns, answered=()):
    return asyncio.run(
        director.decide(
            client,
            "model-director",
            personas=RAT.personas,
            transcript_tail=["Pak Darma: Jangan mimpi, Sri!"],
            after_npc_turn=True,
            last_speaker="sri",
            fallback=WAIT_FOR_USER,
            timeout=1.0,
            npc_turns=npc_turns,
            max_rebuttals=1,
            answered=answered,
        )
    )


@pytest.mark.parametrize(
    "raw,npc_turns,answered,expected",
    [
        ("darma diserang", 1, {"sri"}, "darma"),  # satu sanggahan: boleh
        ("darma diserang", 2, {"sri", "darma"}, WAIT_FOR_USER),  # sanggah-balas: ditolak
        ("darma dipanggil", 3, {"sri"}, "darma"),  # dipanggil pimpinan & belum menyahut
        ("darma dipanggil", 2, {"sri", "darma"}, WAIT_FOR_USER),  # klaim palsu: sudah menyahut
        ("darma", 1, {"sri"}, "darma"),  # tanpa alasan = penting → hanya penyambung pertama
        ("darma", 2, {"sri"}, WAIT_FOR_USER),
    ],
)
def test_followup_policy_applied_to_director_answer(
    fake_gemini, raw, npc_turns, answered, expected
):
    assert _decide_after_npc(fake_gemini(raw), npc_turns=npc_turns, answered=answered) == expected
