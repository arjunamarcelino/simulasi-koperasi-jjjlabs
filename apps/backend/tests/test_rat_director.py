"""Direktur RAT: pencocokan jawaban (F2) + guard keras I8 + fallback (error/timeout)."""

from __future__ import annotations

import asyncio

import pytest
from rat import director
from rat.director import WAIT_FOR_USER, match_choice, mentioned_persona
from scenarios import get_scenario

RAT = get_scenario("rapat-anggota-tahunan").rat
PHASE = RAT.phases[1]


def _decide(client, *, after_npc_turn: bool, last_speaker=None, fallback="sri", timeout=1.0):
    return asyncio.run(
        director.decide(
            client,
            "model-director",
            personas=RAT.personas,
            phase=PHASE,
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


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Pak Darma, tolong tenang dulu.", "darma"),
        ("Ibu Sri bagaimana pendapat Anda?", "sri"),
        ("Pak Darma dan Ibu Sri, mari kita voting.", None),  # dua nama → direktur
        ("Kita lanjutkan rapatnya.", None),
        ("Srikandi desa hadir.", None),  # bukan nama utuh
    ],
)
def test_mentioned_persona(text, expected):
    assert mentioned_persona(text, RAT.name_mentions) == expected


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


def test_prompt_lists_only_valid_choices_and_phase_hint(fake_gemini):
    client = fake_gemini("sri")
    _decide(client, after_npc_turn=False)
    system = client.calls[0]["config"].system_instruction
    assert WAIT_FOR_USER not in system  # bukan pilihan pada giliran pemain
    assert PHASE.director_hint in system
    assert "Pak Darma" in system and "Ibu Sri" in system
