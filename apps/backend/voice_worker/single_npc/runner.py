"""Skenario satu NPC (Tutorial, Kredit Macet, Keanggotaan Fiktif) di atas Gemini Live.

Satu `AgentSession` dengan `RealtimeModel` yang MENDENGAR mic pemain langsung: untuk satu
NPC, auto-reply Gemini Live memang perilaku yang diinginkan (tak ada NPC lain yang bisa
"salah menjawab"). Transkrip input Gemini muncul sebagai conversation item → observer.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    ConversationItemAddedEvent,
    JobContext,
    RunContext,
    function_tool,
    llm,
)

import settings
from evaluation.auditor import run_auditor
from evaluation.mentor import generate_hint
from gemini.client import make_realtime_model
from runtime.drift import DriftMonitor
from runtime.lifecycle import SessionLifecycle
from runtime.publisher import Publisher
from runtime.rpc import register_rpcs
from runtime.tasks import BackgroundTasks
from scenarios import Scenario
from schemas import HistoryEntry

logger = logging.getLogger("koperasi.single_npc")


def _transcript(session: AgentSession) -> list[tuple[str, str]]:
    """Ambil (role, text) untuk giliran user & assistant dari riwayat."""
    out: list[tuple[str, str]] = []
    for item in session.history.items:
        role = getattr(item, "role", None)
        if role in ("user", "assistant"):
            out.append((role, getattr(item, "text_content", "") or ""))
    return out


def scripted_result(scenario: Scenario, trigger: str) -> dict:
    r = scenario.scripted_result
    assert r is not None, "skenario tanpa auditor wajib punya scripted_result"
    return {
        "scenarioId": scenario.scenario_id,
        "trigger": trigger,
        "stateClassification": {},
        "scores": {},
        "endingType": r.ending_type,
        "narrativeFeedback": r.narrative_feedback,
        "values": {},
        "progressFeedback": "",
        "nextStep": "",
        "evaluationFailed": False,
    }


async def run_single_npc(
    ctx: JobContext,
    scenario: Scenario,
    ai_client: Any,
    history: list[HistoryEntry],
) -> None:
    models = settings.models()
    publisher = Publisher(ctx.room)
    tasks = BackgroundTasks()

    session = AgentSession(
        llm=make_realtime_model(voice=scenario.voice, instructions=scenario.prompt)
    )

    def _goal_tools() -> list[llm.FunctionTool]:
        # Sinyal "tujuan tercapai": agent memanggil tool saat tujuan terpenuhi →
        # publish attribute `goal_reached` (FE membuka tombol akhiri).
        if not scenario.goal_tool_prompt:
            return []

        async def catat_kesepakatan(context: RunContext) -> str:  # noqa: ARG001
            await publisher.goal_reached()
            return "Tercatat. Lanjutkan menutup percakapan secara natural."

        return [
            function_tool(
                catat_kesepakatan,
                name="catat_kesepakatan",
                description=scenario.goal_tool_prompt,
            )
        ]

    agent = Agent(instructions=scenario.prompt, tools=_goal_tools())

    async def _finalize(trigger: str) -> dict:
        if scenario.auditor is None:
            return scripted_result(scenario, trigger)
        return await run_auditor(
            ai_client,
            models.auditor,
            scenario,
            _transcript(session),
            trigger,
            history=history,
            fallback_model=models.auditor_fallback,
        )

    async def _stop_speaking() -> None:
        await session.interrupt(force=True)

    lifecycle = SessionLifecycle(
        stop_speaking=_stop_speaking, finalize=_finalize, publisher=publisher
    )

    if scenario.drift is not None:
        drift = DriftMonitor(
            spec=scenario.drift,
            ai_client=ai_client,
            model=models.observer,
            publisher=publisher,
            lifecycle=lifecycle,
            tasks=tasks,
        )
        last_npc_text = ""

        @session.on("conversation_item_added")
        def _on_item(event: ConversationItemAddedEvent) -> None:
            nonlocal last_npc_text
            role = getattr(event.item, "role", None)
            text = (getattr(event.item, "text_content", "") or "").strip()
            if role == "assistant":
                last_npc_text = text
            elif role == "user" and text:
                drift.on_player_turn(text, last_npc_text)

    # --- RPC (CONTRACT.md §3) ---
    async def _end_session(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
        return json.dumps(await lifecycle.end_manual())

    async def _petunjuk(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
        if lifecycle.ended:
            return json.dumps({"hint": "Sesi sudah berakhir."})
        hint = await generate_hint(ai_client, models.mentor, scenario, _transcript(session))
        logger.info("Petunjuk diminta → %r", hint[:80])
        return json.dumps({"hint": hint})

    async def _send_text(data: rtc.RpcInvocationData) -> str:
        text = (data.payload or "").strip()
        if text and not lifecycle.ended:
            session.generate_reply(user_input=text)
        return "ok"

    register_rpcs(
        [ctx.room],
        {"end_session": _end_session, "petunjuk": _petunjuk, "send_text": _send_text},
    )

    async def _cleanup() -> None:
        tasks.cancel_all()

    ctx.add_shutdown_callback(_cleanup)

    await session.start(agent=agent, room=ctx.room)
    # Satu pembicara tetap sepanjang sesi.
    await publisher.speaker(scenario.npc_name)
    await session.generate_reply(instructions=scenario.greeting_instructions)
