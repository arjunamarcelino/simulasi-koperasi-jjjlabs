"""Factory klien Google: `genai.Client` (panggilan JSON) & `RealtimeModel` (NPC suara).

Satu tempat yang menerjemahkan `settings.GoogleAuth` → argumen SDK, supaya AI Studio vs
Vertex (keputusan D5) cukup diatur lewat env tanpa menyentuh pemanggil.
"""

from __future__ import annotations

from google import genai
from livekit.plugins import google

import settings


def make_genai_client() -> genai.Client:
    auth = settings.google_auth()
    if auth.use_vertexai:
        return genai.Client(vertexai=True, project=auth.project, location=auth.location)
    return genai.Client(api_key=auth.api_key)


def make_realtime_model(*, voice: str, instructions: str) -> google.realtime.RealtimeModel:
    """Model Gemini Live untuk satu NPC. Suara terikat sejak konstruksi (tak ditukar)."""
    auth = settings.google_auth()
    kwargs: dict = {
        "model": settings.models().live,
        "voice": voice,
        "instructions": instructions,
        "vertexai": auth.use_vertexai,
    }
    if auth.use_vertexai:
        if auth.project:
            kwargs["project"] = auth.project
        if auth.location:
            kwargs["location"] = auth.location
    elif auth.api_key:
        kwargs["api_key"] = auth.api_key
    return google.realtime.RealtimeModel(**kwargs)
