"""Direktur: siapa yang bicara berikutnya (spec §5.5, §6.6).

Satu panggilan LLM kecil per batas giliran — termasuk SETIAP giliran pemain, juga saat
pemain menyebut nama NPC (pola kode latihan: tak ada pintasan nama di kode; direktur yang
membedakan NPC yang diajak bicara dari yang sekadar dibicarakan). Keputusannya MENGIKAT
karena NPC tak punya telinga (I1). Semua guard keras ada di KODE, bukan hanya di prompt (I8):
  (a) giliran pemain tidak boleh dijawab `tunggu_user`,
  (b) NPC yang barusan bicara tidak boleh dipilih lagi,
  (c) jawaban tak valid / error / timeout → fallback,
  (d) penyambung NPC→NPC WAJIB beralasan, dan alasan itu ditimbang di kode
      (`allow_followup`) — tanpa ini NPC hampir selalu saling balas sampai batas.

Isi watak (`domain`) berasal dari `scenarios.py`; modul ini hanya mekanisme.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Collection, Sequence
from typing import Any

from gemini.json_call import complete
from scenarios import Persona

logger = logging.getLogger("koperasi.rat.director")

WAIT_FOR_USER = "tunggu_user"
TRANSCRIPT_WINDOW = 8  # baris transkrip terakhir yang dibaca direktur

# Alasan penyambung setelah giliran NPC (dari yang terkuat).
CALLED = "dipanggil"  # pimpinan memanggil/menyuruh NPC ini dan ia belum menyahut
ATTACKED = "diserang"  # posisinya baru saja diserang langsung oleh NPC lain
IMPORTANT = "penting"  # punya hal baru yang penting dari posisinya sendiri
REASONS = (CALLED, ATTACKED, IMPORTANT)


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


def parse_reason(raw: str) -> str | None:
    """Alasan penyambung di jawaban direktur (mis. "darma diserang"). Tak ada → None."""
    found = [r for r in REASONS if re.search(r"(?<![a-z])" + r + r"(?![a-z])", raw.lower())]
    return found[0] if len(found) == 1 else None


def allow_followup(reason: str, *, npc_turns: int, max_rebuttals: int) -> bool:
    """Boleh-tidaknya NPC menyambung, setelah `npc_turns` giliran NPC sejak pimpinan bicara.

    - `dipanggil`: selalu boleh — pimpinan menunggu jawabannya.
    - `diserang`: paling banyak `max_rebuttals` sanggahan per giliran pemain.
    - `penting`: hanya sebagai penyambung PERTAMA.
    Batas total pertukaran tetap dijaga rantai (`max_npc_exchanges`).
    """
    if reason == CALLED:
        return True
    if reason == ATTACKED:
        return npc_turns <= max_rebuttals
    return npc_turns <= 1


def _roster(personas: Sequence[Persona]) -> str:
    return "\n".join(f"- {p.key} ({p.name}): {p.domain}" for p in personas)


def _rules(
    personas: Sequence[Persona],
    *,
    after_npc_turn: bool,
    last_speaker: str | None,
    npc_turns: int = 0,
) -> str:
    if not after_npc_turn:
        return (
            "PIMPINAN RAPAT (pemain) baru saja bicara, jadi WAJIB ada NPC yang menjawab. "
            "Bila pimpinan menyapa, memerintah, atau bertanya kepada satu NPC, pilih NPC itu. "
            "Bila pimpinan menyebut DUA nama, pilih yang DIAJAK BICARA (yang disapa langsung "
            "atau diminta menanggapi), BUKAN yang hanya dibicarakan — contoh: 'Pak Darma, "
            "tanggapi usulan Ibu Sri' berarti pilih Pak Darma. Ucapan pimpinan bisa terpotong "
            "jadi beberapa baris berurutan; baca semuanya sebagai satu ucapan. Bila tidak ada "
            "nama, pilih NPC yang posisinya paling tersentuh oleh ucapan pimpinan. Bila "
            "pimpinan bicara ke seluruh forum, pilih satu saja; yang lain akan menyusul "
            "sendiri di giliran berikutnya."
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
        f"Seorang NPC baru saja selesai bicara; sudah {npc_turns} giliran NPC sejak pimpinan "
        "terakhir bicara. TIDAK setiap ucapan perlu dibalas — di rapat sungguhan orang tak "
        "selalu menyahut, dan pimpinan yang memegang kendali. Pilih NPC lain HANYA bila ada "
        "salah satu alasan berikut, lalu sebutkan alasannya:\n"
        f"- {CALLED}: pada ucapan TERAKHIRNYA pimpinan menyebut, menyapa, memerintah, atau "
        "bertanya kepada NPC itu, dan NPC itu BELUM menyahut sejak ucapan tersebut.\n"
        f"- {ATTACKED}: ucapan barusan LANGSUNG menyerang posisi NPC itu dan ia BELUM "
        "menyanggahnya. Sekadar disebut namanya bukan serangan.\n"
        f"- {IMPORTANT}: NPC itu punya hal BARU yang benar-benar penting dari posisinya "
        "sendiri, bukan mengulang.\n"
        f"Bila tak ada alasan, topiknya tuntas, atau ucapan barusan menunggu keputusan "
        f"pimpinan, jawab '{WAIT_FOR_USER}'."
    )


def build_system_prompt(
    personas: Sequence[Persona],
    *,
    after_npc_turn: bool,
    last_speaker: str | None,
    npc_turns: int = 0,
) -> tuple[str, list[str]]:
    """Kembalikan (system prompt, daftar pilihan valid).

    Struktur mengikuti direktur kode latihan: roster ber-`domain` + aturan giliran saja.
    SENGAJA tanpa petunjuk per fase — petunjuk semacam "Ibu Sri paling relevan" membuat
    satu NPC mendominasi; posisi tiap NPC sudah cukup diwakili `domain`.
    """
    choices = [p.key for p in personas]
    if after_npc_turn:
        choices.append(WAIT_FOR_USER)
        answer = (
            f"Balas HANYA dalam format '<nama> <alasan>' (nama: "
            f"{', '.join(p.key for p in personas)}; alasan: {', '.join(REASONS)}), "
            f"atau '{WAIT_FOR_USER}' saja. Tanpa penjelasan."
        )
    else:
        answer = f"Balas HANYA satu kata: {', '.join(choices)}. Tanpa penjelasan, tanpa tanda baca."
    system = (
        "Kamu sutradara internal sebuah Rapat Anggota Tahunan koperasi. Tugasmu HANYA "
        "menentukan siapa yang bicara berikutnya.\n\n"
        f"Daftar NPC:\n{_roster(personas)}\n\n"
        f"{_rules(personas, after_npc_turn=after_npc_turn, last_speaker=last_speaker,
                  npc_turns=npc_turns)}\n\n"
        f"{answer}"
    )
    return system, choices


async def decide(
    client: Any,
    model: str,
    *,
    personas: Sequence[Persona],
    transcript_tail: Sequence[str],
    after_npc_turn: bool,
    last_speaker: str | None,
    fallback: str,
    timeout: float,
    npc_turns: int = 0,
    max_rebuttals: int = 1,
    answered: Collection[str] = (),
) -> str:
    """Pilih key persona berikutnya, atau `WAIT_FOR_USER` (hanya setelah giliran NPC).

    `fallback` dipakai pada jawaban tak valid / error / timeout. Untuk giliran pemain,
    fallback HARUS sebuah persona (pemain wajib dijawab); setelah giliran NPC, pemanggil
    memberi `WAIT_FOR_USER`.

    Setelah giliran NPC: `npc_turns` = giliran NPC sejak pimpinan terakhir bicara,
    `answered` = NPC yang sudah menyahut sejak itu (klaim `dipanggil` untuk mereka tak
    dipercaya), `max_rebuttals` = batas sanggahan per giliran pemain (guard d).
    """
    system, choices = build_system_prompt(
        personas, after_npc_turn=after_npc_turn, last_speaker=last_speaker, npc_turns=npc_turns
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
                max_output_tokens=16,
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
    # (d) penyambung NPC→NPC harus beralasan cukup kuat untuk posisinya di rantai.
    if after_npc_turn and decided != WAIT_FOR_USER:
        reason = parse_reason(raw) or IMPORTANT  # tanpa alasan → dianggap yang terlemah
        if reason == CALLED and decided in answered:
            reason = IMPORTANT  # sudah menyahut sejak pimpinan bicara → bukan "dipanggil"
        if not allow_followup(reason, npc_turns=npc_turns, max_rebuttals=max_rebuttals):
            logger.info(
                "direktur: %s/%s ditolak (giliran NPC ke-%d) → %s",
                decided, reason, npc_turns + 1, WAIT_FOR_USER,
            )
            decided = WAIT_FOR_USER
    logger.info("direktur -> '%s' (dipakai: '%s')", raw, decided)
    return decided
