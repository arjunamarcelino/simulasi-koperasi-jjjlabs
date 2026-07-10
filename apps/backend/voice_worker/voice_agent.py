"""Voice agent worker — livekit-agents v1.6.5.

Satu proses menangani seluruh skenario (PRD §2.1). STT (Azure) → LLM dialog
(gpt-5-mini) → TTS (Azure). Skenario ber-drift (2/3/4) menambah observer
asinkron (Lapisan 2) + AI Auditor gpt-5.4 (Lapisan 3) dan tiga jalur akhir sesi.

Skenario 4 (RAT) menambah DUA NPC dalam satu sesi lewat satu `RatAgent` yang
menukar prompt (`update_instructions`) & suara (`tts_node`) per persona aktif,
plus state machine fase (RPC `advance_phase`).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import AsyncIterable

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    ConversationItemAddedEvent,
    JobContext,
    ModelSettings,
    cli,
    llm,
)
from livekit.plugins import azure, openai, silero
from openai import AsyncAzureOpenAI

from auditor import run_auditor
from mentor import generate_hint
from observer import DriftTracker, evaluate_turn
from scenarios import RatSpec, Scenario, get_scenario

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger("koperasi.voice_agent")

AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "koperasi-agent")
SESSION_ENDED_TOPIC = "session_ended"
# Sinyal "siapa yang bicara" per giliran NPC — sumber kebenaran identitas
# pembicara untuk FE/game (yang menampilkan karakter). PRD §9 (kontrak).
SPEAKER_TOPIC = "speaker"

server = AgentServer()


def _build_llm() -> openai.LLM:
    return openai.LLM.with_azure(
        azure_deployment=os.environ["AZURE_OPENAI_DEPLOYMENT_DIALOGUE"],
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-01-preview"),
    )


def _build_openai_client() -> AsyncAzureOpenAI:
    """Klien langsung untuk observer + auditor (panggilan JSON sekali-jalan)."""
    return AsyncAzureOpenAI(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-01-preview"),
    )


def _azure_tts(voice: str) -> azure.TTS:
    return azure.TTS(
        voice=voice,
        language="id-ID",
        speech_key=os.environ["AZURE_SPEECH_KEY"],
        speech_region=os.environ["AZURE_SPEECH_REGION"],
    )


def _transcript(session: AgentSession) -> list[tuple[str, str]]:
    """Ambil (role, text) untuk giliran user & assistant dari riwayat."""
    out: list[tuple[str, str]] = []
    for item in session.history.items:
        role = getattr(item, "role", None)
        if role in ("user", "assistant"):
            out.append((role, getattr(item, "text_content", "") or ""))
    return out


class RatState:
    """State bersama antara RatAgent & entrypoint (RAT)."""

    def __init__(self, default_persona: str) -> None:
        self.active = default_persona
        self.phase_index = 0


class RatAgent(Agent):
    """Satu agent, dua persona. Prompt ditukar via update_instructions; suara
    ditukar dengan override tts_node ke TTS persona aktif (PRD §2.1)."""

    def __init__(
        self,
        rat: RatSpec,
        state: RatState,
        on_speak: Callable[[str], Awaitable[None]] | None = None,
    ) -> None:
        super().__init__(instructions=rat.persona(state.active).prompt)
        self._rat = rat
        self._state = state
        self._on_speak = on_speak
        self._persona_tts = {p.key: _azure_tts(p.voice) for p in rat.personas}

    async def route(self, text: str) -> None:
        """Heuristik penyebutan nama → set persona aktif + tukar prompt. Dipanggil
        dari jalur suara (on_user_turn_completed) & teks (RPC send_text)."""
        lower = (text or "").lower()
        for keyword, persona_key in self._rat.name_mentions.items():
            if keyword in lower:
                if persona_key != self._state.active:
                    self._state.active = persona_key
                    logger.info("Name-mention → persona aktif: %s", persona_key)
                break
        await self.update_instructions(self._rat.persona(self._state.active).prompt)

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        await self.route(new_message.text_content or "")

    async def tts_node(
        self, text: AsyncIterable[str], model_settings: ModelSettings
    ) -> AsyncIterable[rtc.AudioFrame]:
        persona = self._rat.persona(self._state.active)
        logger.info("TTS persona: %s", persona.key)
        # Umumkan pembicara SEBELUM audio keluar → FE/game tahu karakter mana
        # yang bicara sebelum kata pertama muncul.
        if self._on_speak is not None:
            await self._on_speak(persona.name)
        active_tts = self._persona_tts[self._state.active]
        collected = ""
        async for chunk in text:
            collected += chunk
        collected = collected.strip()
        if not collected:
            return
        async for audio in active_tts.synthesize(collected):
            yield audio.frame


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    metadata = json.loads(ctx.job.metadata or "{}")
    scenario_id = metadata.get("scenario_id", "")
    scenario = get_scenario(scenario_id)
    logger.info("Sesi mulai: scenario=%s room=%s", scenario_id, ctx.room.name)

    await ctx.connect()

    default_voice = (
        scenario.rat.persona(scenario.rat.phases[0].default_persona).voice
        if scenario.rat
        else scenario.voice
    )
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=azure.STT(
            language="id-ID",
            speech_key=os.environ["AZURE_SPEECH_KEY"],
            speech_region=os.environ["AZURE_SPEECH_REGION"],
        ),
        llm=_build_llm(),
        tts=_azure_tts(default_voice),
    )

    ai_client = _build_openai_client()
    auditor_deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT_AUDITOR", "")
    dialogue_deployment = os.environ["AZURE_OPENAI_DEPLOYMENT_DIALOGUE"]

    # State sesi (in-memory, PRD §2.5).
    ended = False
    tracker = DriftTracker(scenario.drift) if scenario.drift else None
    last_npc_text = ""
    bg_tasks: set[asyncio.Task] = set()

    async def _publish_speaker(name: str) -> None:
        """Umumkan identitas pembicara NPC (untuk FE/game menampilkan karakter)."""
        await ctx.room.local_participant.publish_data(
            json.dumps({"name": name}), topic=SPEAKER_TOPIC
        )

    rat_state: RatState | None = (
        RatState(scenario.rat.phases[0].default_persona) if scenario.rat else None
    )
    agent: Agent = (
        RatAgent(scenario.rat, rat_state, on_speak=_publish_speaker)
        if scenario.rat and rat_state
        else Agent(instructions=scenario.prompt)
    )

    def _spawn(coro) -> None:
        task = asyncio.create_task(coro)
        bg_tasks.add(task)

        def _done(t: asyncio.Task) -> None:
            bg_tasks.discard(t)
            if not t.cancelled() and t.exception() is not None:
                logger.error("Observer task gagal", exc_info=t.exception())

        task.add_done_callback(_done)

    async def _finalize(trigger: str) -> dict:
        if scenario.auditor is None:
            r = scenario.scripted_result
            assert r is not None
            return {
                "scenarioId": scenario.scenario_id,
                "trigger": trigger,
                "stateClassification": {},
                "scores": {},
                "endingType": r.ending_type,
                "narrativeFeedback": r.narrative_feedback,
            }
        return await run_auditor(
            ai_client, auditor_deployment, scenario, _transcript(session), trigger
        )

    async def _force_quit() -> None:
        nonlocal ended
        if ended:
            return
        ended = True
        await session.interrupt(force=True)
        result = await _finalize("force_quit_level_2")
        await ctx.room.local_participant.publish_data(
            json.dumps(result), topic=SESSION_ENDED_TOPIC
        )

    async def _observe(player_text: str, npc_context: str) -> None:
        if ended or tracker is None or scenario.drift is None:
            return
        judgment = await evaluate_turn(
            ai_client, dialogue_deployment, scenario.drift, player_text, npc_context
        )
        prev = tracker.level
        level = tracker.apply(judgment)
        logger.info(
            "Observer: judgment=%s level=%d (prev=%d) text=%r",
            judgment,
            level,
            prev,
            player_text[:80],
        )
        if level != prev:
            logger.info("Drift berubah %d→%d — publish attribute", prev, level)
            await ctx.room.local_participant.set_attributes({"drift_level": str(level)})
        if level == 2:
            logger.info("Level 2 tercapai — force quit")
            await _force_quit()

    async def _publish_phase() -> None:
        assert scenario.rat is not None and rat_state is not None
        phase = scenario.rat.phases[rat_state.phase_index]
        payload = {
            "phase": phase.id,
            "label": phase.label,
            "advanceActionLabel": phase.advance_action_label,
        }
        await ctx.room.local_participant.set_attributes({"phase": json.dumps(payload)})

    if scenario.drift is not None:

        @session.on("conversation_item_added")
        def _on_item(event: ConversationItemAddedEvent) -> None:
            nonlocal last_npc_text
            role = getattr(event.item, "role", None)
            text = (getattr(event.item, "text_content", "") or "").strip()
            if role == "assistant":
                last_npc_text = text
            elif role == "user" and text:
                logger.info("Giliran pemain terdeteksi → jalankan observer")
                _spawn(_observe(text, last_npc_text))

    # --- RPC: Keputusan Akhir / Bayar & Daftar → hasil akhir ---
    @ctx.room.local_participant.register_rpc_method("end_session")
    async def _end_session(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
        nonlocal ended
        await session.interrupt(force=True)
        ended = True
        result = await _finalize("manual")
        return json.dumps(result)

    # --- RPC: Petunjuk (mentor kontekstual, menggantikan "Tanya Mentor") ---
    @ctx.room.local_participant.register_rpc_method("petunjuk")
    async def _petunjuk(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
        if ended:
            return json.dumps({"hint": "Sesi sudah berakhir."})
        hint = await generate_hint(
            ai_client, dialogue_deployment, scenario, _transcript(session)
        )
        logger.info("Petunjuk diminta → %r", hint[:80])
        return json.dumps({"hint": hint})

    # --- RPC: jalur fallback teks (PRD Prinsip 4) ---
    @ctx.room.local_participant.register_rpc_method("send_text")
    async def _send_text(data: rtc.RpcInvocationData) -> str:
        text = (data.payload or "").strip()
        if text and not ended:
            # Jalur teks tidak memicu on_user_turn_completed, jadi routing nama
            # dilakukan di sini sebelum balasan (khusus RAT).
            if isinstance(agent, RatAgent):
                await agent.route(text)
            session.generate_reply(user_input=text)
        return "ok"

    # --- RPC: aksi agenda RAT → maju satu fase ---
    if scenario.rat is not None and rat_state is not None:
        rat = scenario.rat

        @ctx.room.local_participant.register_rpc_method("advance_phase")
        async def _advance_phase(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
            if ended or rat_state.phase_index >= len(rat.phases) - 1:
                return "noop"
            rat_state.phase_index += 1
            phase = rat.phases[rat_state.phase_index]
            rat_state.active = phase.default_persona
            await agent.update_instructions(rat.persona(rat_state.active).prompt)
            await _publish_phase()
            logger.info("Fase → %d (%s)", phase.id, phase.label)
            if phase.entry_line is not None:
                persona_key, line = phase.entry_line
                rat_state.active = persona_key
                await agent.update_instructions(rat.persona(persona_key).prompt)
                session.say(line)  # interupsi terskrip dengan suara persona itu
            return "ok"

    await session.start(agent=agent, room=ctx.room)
    if scenario.rat is not None:
        await _publish_phase()  # Fase 1 awal
    else:
        # Single-NPC: satu pembicara tetap sepanjang sesi.
        await _publish_speaker(scenario.npc_name)
    await session.generate_reply(instructions=scenario.greeting_instructions)


if __name__ == "__main__":
    cli.run_app(server)
