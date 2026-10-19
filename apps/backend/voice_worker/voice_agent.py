"""Voice agent worker — livekit-agents 1.8 + Google (Gemini Live, Cloud STT).

Entry TIPIS: satu proses menangani seluruh skenario (PRD §2.1). Job membawa
`scenario_id` di metadata dispatch (dari `POST /token`), lalu diteruskan ke runner:

- `single_npc/runner.py` — satu NPC Gemini Live yang mendengar mic langsung.
- `rat/runner.py`        — RAT: dua NPC tanpa telinga + Listener STT + direktur.

Jalankan: `uv run python voice_worker/voice_agent.py dev`.
"""

from __future__ import annotations

import json
import logging

from livekit.agents import AgentServer, JobContext, cli

import settings
from gemini.client import make_genai_client
from rat.runner import run_rat
from scenarios import get_scenario
from single_npc.runner import run_single_npc

logger = logging.getLogger("koperasi.voice_agent")

server = AgentServer()


@server.rtc_session(agent_name=settings.AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    metadata = json.loads(ctx.job.metadata or "{}")
    scenario_id = metadata.get("scenario_id", "")
    scenario = get_scenario(scenario_id)
    logger.info("Sesi mulai: scenario=%s room=%s", scenario_id, ctx.room.name)

    await ctx.connect()

    # Satu klien genai per sesi untuk observer / auditor / mentor / direktur.
    ai_client = make_genai_client()
    ctx.add_shutdown_callback(ai_client.aio.aclose)  # tutup pool httpx klien per sesi (worker long-lived)
    if scenario.rat is not None:
        await run_rat(ctx, scenario, ai_client)
    else:
        await run_single_npc(ctx, scenario, ai_client)


if __name__ == "__main__":
    cli.run_app(server)
