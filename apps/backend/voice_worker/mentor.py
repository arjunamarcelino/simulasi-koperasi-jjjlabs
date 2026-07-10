"""Fitur Petunjuk — mentor kontekstual (menggantikan "Tanya Mentor", PRD §9).

Panggilan gpt-5-mini sekali-jalan (di luar ChatContext dialog, seperti observer &
auditor) yang membaca transkrip sejauh ini + brief skenario, lalu memberi SATU
petunjuk singkat & ramah pemula tentang apa yang sebaiknya pemain (petugas)
lakukan berikutnya. Tidak memerankan NPC, tidak membocorkan bahwa ini AI, dan
tetap dalam konteks tata kelola koperasi. Gagal-aman → petunjuk fallback.
"""

from __future__ import annotations

import json
import logging

from openai import AsyncAzureOpenAI

from scenarios import Scenario

logger = logging.getLogger("koperasi.mentor")

_FALLBACK = (
    "Fokus pada tujuan skenario ini: dengarkan lawan bicara, gali informasi "
    "yang relevan, lalu ambil langkah yang sesuai prosedur koperasi."
)

_SYSTEM = """\
Kamu adalah MENTOR yang ramah dalam simulasi pelatihan tata kelola koperasi
Indonesia. Pemain (petugas koperasi) menekan tombol "Petunjuk" karena mungkin
bingung — banyak pemain muda belum paham koperasi. Tugasmu memberi SATU petunjuk
singkat tentang apa yang sebaiknya ia lakukan BERIKUTNYA.

Skenario: {scenario_id} — NPC: {npc_name}
Tujuan & konteks skenario (jadikan acuan):
{brief}

Aturan menjawab:
- Bahasa Indonesia, ramah dan sederhana, MAKSIMAL 2 kalimat.
- Beri arahan langkah konkret yang bisa langsung dilakukan pemain, bukan teori panjang.
- INTERAKSI GAME INI HANYA PERCAKAPAN (suara/teks). Sarankan langkah yang bisa
  dilakukan LEWAT BERBICARA: bertanya, mendengarkan, menjelaskan, menawarkan solusi.
  JANGAN menyuruh pemain melakukan tindakan dunia-nyata yang mustahil di sini —
  meminta/menerima dokumen fisik saat itu juga, memfoto, mendatangi lokasi, atau
  kontak fisik. Bila bukti/dokumen relevan, arahkan pemain MENGGALINYA lewat
  pertanyaan atau menyepakati untuk memeriksanya nanti — KECUALI skenario memang
  menyediakan mekanik dalam-game untuk itu (mis. tombol "Periksa Dokumen").
- Dorong pemain MAJU: utamakan langkah menuju SOLUSI, bukan hanya menggali terus.
- Perhatikan transkrip: JANGAN mengulang saran yang sudah jelas dilakukan pemain.
  Bila ia tampak mandek pada satu pendekatan, tawarkan langkah/alternatif berbeda.
- JANGAN memerankan atau menirukan NPC. Kamu berbicara sebagai mentor kepada pemain.
- Tetap dalam konteks skenario koperasi ini saja. Jangan menyebut dirimu AI/model/prompt.
- Jangan memberi vonis benar/salah atau skor; cukup dorong langkah selanjutnya.

Balas HANYA JSON: {{"hint": "..."}}
"""


def _format_transcript(transcript: list[tuple[str, str]]) -> str:
    lines = []
    for role, text in transcript:
        who = {"user": "PETUGAS", "assistant": "NPC"}.get(role, role.upper())
        if text:
            lines.append(f"{who}: {text}")
    if not lines:
        return "(percakapan belum dimulai — pemain baru saja masuk sesi)"
    # Cukup beberapa giliran terakhir agar petunjuk relevan & hemat token.
    return "\n".join(lines[-8:])


async def generate_hint(
    client: AsyncAzureOpenAI,
    deployment: str,
    scenario: Scenario,
    transcript: list[tuple[str, str]],
) -> str:
    """Kembalikan satu petunjuk singkat untuk pemain. Gagal-aman → fallback."""
    brief = scenario.mentor_brief or _FALLBACK
    system = _SYSTEM.format(
        scenario_id=scenario.scenario_id,
        npc_name=scenario.npc_name,
        brief=brief,
    )
    try:
        resp = await client.chat.completions.create(
            model=deployment,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": _format_transcript(transcript)},
            ],
        )
        content = resp.choices[0].message.content or "{}"
        hint = (json.loads(content).get("hint") or "").strip()
        return hint or _FALLBACK
    except Exception:  # noqa: BLE001 — Petunjuk tak boleh menjatuhkan sesi
        logger.exception("Mentor gagal membuat petunjuk; kirim fallback.")
        return _FALLBACK
