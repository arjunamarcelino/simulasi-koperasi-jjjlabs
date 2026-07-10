"""AI Auditor — Lapisan 3 (PRD §6).

Satu panggilan gpt-5.4 di akhir sesi: baca transkrip penuh + taksonomi +
grounding, kembalikan JSON (klasifikasi state + skor + narasi). Narasi
di-generate untuk kombinasi state apa pun (keputusan tim, PRD §10.6).
"""

from __future__ import annotations

import json
import logging

from openai import AsyncAzureOpenAI

from scenarios import Scenario

logger = logging.getLogger("koperasi.auditor")

_SYSTEM = """\
Kamu adalah AI Auditor untuk simulasi tata kelola koperasi Indonesia. Kamu membaca
transkrip penuh satu sesi dan memberi evaluasi formal.

Skenario: {scenario_id}
Jalur pemicu sesi berakhir: {trigger} (konteks saja — BUKAN penentu klasifikasi).

Taksonomi state yang HARUS kamu klasifikasikan (pilih tepat satu nilai per state):
{taxonomy}

Grounding regulasi:
{grounding}

Gaya & nada narasi (jadikan acuan, jangan disalin):
{style_anchor}

Tugas:
1. Klasifikasikan setiap state berdasarkan pembacaan holistik transkrip.
2. Beri skor 0–100 untuk tiap dimensi: {score_keys}.
3. Tentukan ending_type: "good" | "bad" | "neutral".
4. Tulis narrative_feedback (Bahasa Indonesia, 2–4 kalimat) yang KONKRET merujuk
   perilaku pemain di transkrip dan menyebut grounding bila relevan. Generate
   narasi untuk kombinasi state APA PUN yang tercapai.

Balas HANYA JSON valid, tanpa teks pembuka/penutup, dengan bentuk PERSIS:
{{
  "stateClassification": {{ {state_keys} }},
  "scores": {{ {score_pairs} }},
  "endingType": "good|bad|neutral",
  "narrativeFeedback": "..."
}}
"""


def _format_transcript(transcript: list[tuple[str, str]]) -> str:
    lines = []
    for role, text in transcript:
        who = {"user": "PETUGAS", "assistant": "NPC"}.get(role, role.upper())
        if text:
            lines.append(f"{who}: {text}")
    return "\n".join(lines) if lines else "(transkrip kosong)"


async def run_auditor(
    client: AsyncAzureOpenAI,
    deployment: str,
    scenario: Scenario,
    transcript: list[tuple[str, str]],
    trigger: str,
) -> dict:
    """Panggil gpt-5.4, kembalikan dict berbentuk `AuditorResult` untuk FE."""
    spec = scenario.auditor
    assert spec is not None, "run_auditor dipanggil untuk skenario tanpa auditor"

    taxonomy_str = "\n".join(
        f"- {state}: {' | '.join(values)}" for state, values in spec.taxonomy.items()
    )
    state_keys = ", ".join(f'"{s}": "..."' for s in spec.taxonomy)
    score_pairs = ", ".join(f'"{k}": 0' for k in spec.score_keys)

    system = _SYSTEM.format(
        scenario_id=scenario.scenario_id,
        trigger=trigger,
        taxonomy=taxonomy_str,
        grounding=spec.grounding,
        style_anchor=spec.style_anchor,
        score_keys=", ".join(spec.score_keys),
        state_keys=state_keys,
        score_pairs=score_pairs,
    )

    result: dict
    try:
        resp = await client.chat.completions.create(
            model=deployment,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": _format_transcript(transcript)},
            ],
        )
        result = json.loads(resp.choices[0].message.content or "{}")
    except Exception:  # noqa: BLE001 — jangan biarkan sesi berakhir tanpa hasil
        logger.exception("Auditor gagal; kirim hasil fallback netral.")
        result = {
            "stateClassification": {},
            "scores": {},
            "endingType": "neutral",
            "narrativeFeedback": (
                "Evaluasi otomatis tidak dapat diselesaikan. Silakan tinjau "
                "transkrip secara manual."
            ),
        }

    # Lengkapi field yang dikonsumsi FE (bentuk AuditorResult).
    result.setdefault("stateClassification", {})
    result.setdefault("scores", {})
    result.setdefault("endingType", "neutral")
    result.setdefault("narrativeFeedback", "")
    result["scenarioId"] = scenario.scenario_id
    result["trigger"] = trigger
    return result
