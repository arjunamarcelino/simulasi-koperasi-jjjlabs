"""Satu panggilan teks sekali-jalan ke Gemini (observer / auditor / mentor / direktur).

Sengaja TIPIS dan TIDAK gagal-aman: exception & timeout diteruskan ke pemanggil, karena
tiap pemanggil punya fallback sendiri yang berbeda (observer → "neutral", auditor →
hasil netral, mentor → hint statis, direktur → fallback giliran). Lihat GOTCHA #7.
"""

from __future__ import annotations

import asyncio
from typing import Any

from google.genai import types as genai_types


async def complete(
    client: Any,
    model: str,
    *,
    system: str,
    user: str,
    json_mode: bool = True,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    timeout: float | None = None,
) -> str | None:
    """Kembalikan teks respons (bisa None/"" bila model tak memberi kandidat).

    `json_mode=True` → `response_mime_type="application/json"` (pengganti
    `response_format={"type": "json_object"}` di Azure OpenAI).
    """
    config = genai_types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json" if json_mode else None,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )
    call = client.aio.models.generate_content(model=model, contents=user, config=config)
    resp = await (asyncio.wait_for(call, timeout) if timeout else call)
    return resp.text
