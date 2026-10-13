"""Direktur: siapa yang bicara berikutnya (spec §5.5, §6.6).

Satu panggilan LLM kecil per batas giliran. Keputusannya MENGIKAT karena NPC tak punya
telinga (I1). Semua guard keras ada di KODE, bukan hanya di prompt (I8):
  (a) giliran pemain tidak boleh dijawab `tunggu_user`,
  (b) NPC yang barusan bicara tidak boleh dipilih lagi,
  (c) jawaban tak valid / error / timeout → fallback.

Isi watak (domain) dan petunjuk per fase berasal dari `scenarios.py`; modul ini hanya
mekanisme.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from typing import Any

from gemini.json_call import complete
from scenarios import Persona, RatPhase

logger = logging.getLogger("koperasi.rat.director")

WAIT_FOR_USER = "tunggu_user"
TRANSCRIPT_WINDOW = 8  # baris transkrip terakhir yang dibaca direktur


def match_choice(raw: str, choices: Sequence[str]) -> str | None:
    """Cari TEPAT SATU pilihan valid di jawaban direktur (perbaikan F2).

    Toleran tanda baca, markdown, dan "tunggu user"/"tunggu-user" (garis bawah pada key
    boleh diganti spasi atau tanda hubung). Nol atau >1 cocok (ambigu) → None.
    """
    raw = raw.lower()
    found = {
        k
        for k in choices
        if re.search(r"(?<![a-z0-9])" + k.replace("_", r"[\s_\-]?") + r"(?![a-z0-9])", raw)
    }
    return found.pop() if len(found) == 1 else None


def mentioned_persona(text: str, name_mentions: dict[str, str]) -> str | None:
    """Persona yang DISEBUT pemain, bila tepat satu (mis. "Pak Darma, ..."). Ambigu → None."""
    lower = (text or "").lower()
    found = {
        key
        for kw, key in name_mentions.items()
        if re.search(r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])", lower)
    }
    return found.pop() if len(found) == 1 else None


def _roster(personas: Sequence[Persona]) -> str:
    return "\n".join(f"- {p.key} ({p.name}): {p.domain}" for p in personas)


def _rules(
    personas: Sequence[Persona], *, after_npc_turn: bool, last_speaker: str | None
) -> str:
    if not after_npc_turn:
        return (
            "PIMPINAN RAPAT (pemain) baru saja bicara, jadi WAJIB ada NPC yang menjawab. "
            "Bila pimpinan menyebut atau menyapa satu NPC, pilih NPC itu. Bila tidak, pilih "
            "NPC yang posisinya paling tersentuh oleh ucapan pimpinan. Bila pimpinan bicara "
            "ke seluruh forum, pilih satu saja; yang lain bisa menyusul di giliran berikutnya."
        )
    names = {p.key: p.name for p in personas}
    barusan = (
        f"{names[last_speaker]} ({last_speaker}) BARU SAJA bicara, jadi DILARANG dipilih "
        f"lagi. Pilihanmu hanya NPC lain atau '{WAIT_FOR_USER}'.\n"
        if last_speaker in names
        else ""
    )
    return (
        f"{barusan}"
        "Seorang NPC baru saja selesai bicara. Ini rapat yang bisa memanas: NPC lain BOLEH "
        "menyanggah bila ucapan barusan LANGSUNG menyerang posisinya atau menyebut namanya. "
        f"Selain itu jawab '{WAIT_FOR_USER}' — pimpinan rapat yang memegang kendali, jangan "
        "biarkan para NPC berdebat sendiri tanpa arah."
    )


def build_system_prompt(
    personas: Sequence[Persona],
    phase: RatPhase,
    *,
    after_npc_turn: bool,
    last_speaker: str | None,
) -> tuple[str, list[str]]:
    """Kembalikan (system prompt, daftar pilihan valid)."""
    choices = [p.key for p in personas]
    if after_npc_turn:
        choices.append(WAIT_FOR_USER)
    hint = f"\nKeadaan tahap ini: {phase.director_hint}\n" if phase.director_hint else ""
    system = (
        "Kamu sutradara internal sebuah Rapat Anggota Tahunan koperasi. Tugasmu HANYA "
        "menentukan siapa yang bicara berikutnya.\n\n"
        f"Tahap rapat: Fase {phase.id} — {phase.label}.{hint}\n"
        f"Daftar NPC:\n{_roster(personas)}\n\n"
        f"{_rules(personas, after_npc_turn=after_npc_turn, last_speaker=last_speaker)}\n\n"
        f"Balas HANYA satu kata: {', '.join(choices)}. Tanpa penjelasan, tanpa tanda baca."
    )
    return system, choices


async def decide(
    client: Any,
    model: str,
    *,
    personas: Sequence[Persona],
    phase: RatPhase,
    transcript_tail: Sequence[str],
    after_npc_turn: bool,
    last_speaker: str | None,
    fallback: str,
    timeout: float,
) -> str:
    """Pilih key persona berikutnya, atau `WAIT_FOR_USER` (hanya setelah giliran NPC).

    `fallback` dipakai pada jawaban tak valid / error / timeout. Untuk giliran pemain,
    fallback HARUS sebuah persona (pemain wajib dijawab); setelah giliran NPC, pemanggil
    memberi `WAIT_FOR_USER`.
    """
    system, choices = build_system_prompt(
        personas, phase, after_npc_turn=after_npc_turn, last_speaker=last_speaker
    )
    raw = ""
    try:
        raw = (
            await complete(
                client,
                model,
                system=system,
                user="\n".join(transcript_tail) or "(belum ada percakapan)",
                json_mode=False,
                temperature=0,
                max_output_tokens=10,
                timeout=timeout,
            )
            or ""
        ).strip().lower()
        decided = match_choice(raw, choices) or fallback
    except TimeoutError:
        logger.warning("direktur timeout (%.1fs) → fallback %s", timeout, fallback)
        decided = fallback
    except Exception:  # noqa: BLE001 — direktur tak boleh menjatuhkan giliran
        logger.warning("direktur gagal → fallback %s", fallback, exc_info=True)
        decided = fallback

    # (a) giliran pemain wajib dijawab NPC.
    if not after_npc_turn and decided == WAIT_FOR_USER:
        decided = fallback
    # (b) NPC tak boleh menyambung ucapannya sendiri.
    if after_npc_turn and decided == last_speaker:
        logger.info("direktur memilih %s yang barusan bicara → %s", decided, WAIT_FOR_USER)
        decided = WAIT_FOR_USER
    logger.info("direktur -> '%s' (dipakai: '%s')", raw, decided)
    return decided
