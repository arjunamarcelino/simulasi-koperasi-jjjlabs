"""Rakitan sesi RAT — arsitektur "Telinga ≠ Mulut" (spec §3, §5.7).

    mic pemain ─► Listener (google.STT) ─teks─► Discussion ─► direktur ("siapa berikutnya?")
                                                    │
                     mirror teks ke chat_ctx kedua NPC, lalu generate_reply() pada SATU NPC
                     ├─ NPC host  (ctx.room, koneksi worker)        audio_input=False
                     └─ NPC kedua (rtc.Room sendiri, can_subscribe=False) audio_input=False

Satu room LiveKit, tiga koneksi (pemain, worker, NPC kedua). Host = pemimpin Fase 1
(Ibu Sri, D1). Semua sinyal ke FE (attribute, speaker, session_ended) lewat koneksi worker.
"""

from __future__ import annotations

import contextlib
import json
import logging
from typing import Any

from livekit import rtc
from livekit.agents import AgentSession, ConversationItemAddedEvent, JobContext, room_io

import settings
from evaluation.auditor import run_auditor
from evaluation.mentor import generate_hint
from rat.connection import connect_as_npc
from rat.discussion import Discussion, TranscriptEntry
from rat.floor import Floor
from rat.listener import Listener, make_stt
from rat.npc import NpcAgent, build_instructions
from runtime.drift import DriftMonitor
from runtime.lifecycle import SessionLifecycle
from runtime.publisher import Publisher
from runtime.rpc import register_rpcs
from runtime.tasks import BackgroundTasks
from scenarios import Scenario
from schemas import HistoryEntry

logger = logging.getLogger("koperasi.rat.runner")


def _phase_context(discussion: Discussion) -> str:
    """Konteks tahap untuk Petunjuk — agar mentor mengarahkan pindah tugas secara mulus."""
    ph = discussion.phase
    if ph.advance_action_label:
        nxt = (
            "Bila tugas tahap ini sudah beres, aksi berikutnya untuk pemain adalah "
            f"menekan tombol '{ph.advance_action_label}'."
        )
    else:
        nxt = (
            "Ini tahap terakhir; setelah keputusan diambil secara adil, pemain menutup "
            "sesi lewat tombol 'Keputusan Akhir'."
        )
    return f"Fase {ph.id} — {ph.label}. {nxt}"


async def run_rat(
    ctx: JobContext,
    scenario: Scenario,
    ai_client: Any,
    history: list[HistoryEntry],
) -> None:
    rat = scenario.rat
    assert rat is not None
    assert len(rat.personas) == 2, "arsitektur RAT mengasumsikan TEPAT dua NPC"
    models = settings.models()
    tuning = settings.rat_tuning()
    publisher = Publisher(ctx.room)
    tasks = BackgroundTasks()
    floor = Floor()
    host_key = rat.phases[0].default_persona
    npc_identities = {p.identity for p in rat.personas}

    # F8: STT dibuat paling awal — kredensial GCP salah → job gagal SEBELUM NPC menyapa.
    stt = make_stt(tuning.stt_language)

    # I9: Discussion dibuat sebelum NpcAgent; agent/sesi didaftarkan sebelum start.
    discussion = Discussion(
        rat=rat,
        floor=floor,
        publisher=publisher,
        tasks=tasks,
        director_client=ai_client,
        director_model=models.director,
        director_timeout=tuning.director_timeout,
        settle_delay=tuning.transcript_settle_delay,
        max_npc_exchanges=tuning.max_npc_exchanges,
        max_npc_rebuttals=tuning.max_npc_rebuttals,
    )

    extra_rooms: list[rtc.Room] = []
    # Host lebih dulu: koneksi worker sudah ada, NPC kedua menyusul.
    for persona in sorted(rat.personas, key=lambda p: p.key != host_key):
        agent = NpcAgent(
            key=persona.key,
            voice=persona.voice,
            instructions=build_instructions(rat, persona.key, rat.phases[0]),
            floor=floor,
            playout_tail=tuning.playout_tail,
        )
        session = AgentSession()
        discussion.register(persona.key, agent, session)

        is_host = persona.key == host_key
        room = ctx.room if is_host else await connect_as_npc(ctx.room.name, persona)
        if not is_host:
            extra_rooms.append(room)

        await session.start(
            agent=agent,
            room=room,
            room_options=room_io.RoomOptions(
                # NPC TANPA telinga (I1): tak ada auto-reply; keputusan direktur mengikat.
                audio_input=False,
                text_input=False,
                audio_output=room_io.AudioOutputOptions(track_name=persona.identity),
                close_on_disconnect=is_host,
            ),
        )

        def _on_item(ev: ConversationItemAddedEvent, key: str = persona.key) -> None:
            item = ev.item
            if getattr(item, "type", None) != "message" or item.role != "assistant":
                return
            if text := item.text_content:
                discussion.on_npc_said(key, text)

        session.on("conversation_item_added", _on_item)
        logger.info("%s siap (participant=%s)", persona.key, persona.identity)

    async def _finalize(trigger: str) -> dict:
        return await run_auditor(
            ai_client,
            models.auditor,
            scenario,
            discussion.evaluation_transcript(),
            trigger,
            history=history,
            fallback_model=models.auditor_fallback,
        )

    lifecycle = SessionLifecycle(
        stop_speaking=discussion.close, finalize=_finalize, publisher=publisher
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

        def _observe(entry: TranscriptEntry) -> None:
            if entry.is_player:
                drift.on_player_turn(entry.text, discussion.last_npc_text())

        discussion.add_transcript_listener(_observe)

    # --- RPC (CONTRACT.md §3) — di SEMUA koneksi NPC, lihat runtime/rpc.py ---
    async def _end_session(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
        return json.dumps(await lifecycle.end_manual())

    async def _petunjuk(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
        if lifecycle.ended:
            return json.dumps({"hint": "Sesi sudah berakhir."})
        phase_context = _phase_context(discussion)
        hint = await generate_hint(
            ai_client, models.mentor, scenario, discussion.evaluation_transcript(), phase_context
        )
        logger.info("Petunjuk diminta (fase=%s) → %r", phase_context, hint[:80])
        return json.dumps({"hint": hint})

    async def _send_text(data: rtc.RpcInvocationData) -> str:
        # Jalur teks masuk ke titik yang SAMA dengan jalur suara (Listener).
        text = (data.payload or "").strip()
        if text and not lifecycle.ended:
            tasks.spawn(discussion.on_user_said(text), name="send_text")
        return "ok"

    async def _advance_phase(data: rtc.RpcInvocationData) -> str:  # noqa: ARG001
        if lifecycle.ended:
            return "noop"
        return "ok" if await discussion.advance_phase() else "noop"

    register_rpcs(
        [ctx.room, *extra_rooms],
        {
            "end_session": _end_session,
            "petunjuk": _petunjuk,
            "send_text": _send_text,
            "advance_phase": _advance_phase,
        },
    )

    listener = Listener(
        room=ctx.room,
        stt=stt,
        ignore_identities=npc_identities,
        npc_speaking=floor.npc_speaking,
        on_speech_started=discussion.on_user_started,
        on_utterance=discussion.on_user_said,
        tasks=tasks,
        debounce=tuning.user_turn_debounce,
        echo_guard_budget=tuning.echo_guard_budget,
    )

    async def _cleanup() -> None:
        await listener.aclose()
        await discussion.close()
        tasks.cancel_all()
        for room in extra_rooms:  # AC9: koneksi NPC kedua tak boleh tertinggal di room
            with contextlib.suppress(Exception):
                await room.disconnect()

    ctx.add_shutdown_callback(_cleanup)

    def _on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
        # Pemain pergi → akhiri job (cleanup memutus koneksi NPC kedua). Room tak akan
        # kosong sendiri karena NPC kedua masih tersambung.
        if participant.identity not in npc_identities:
            logger.info("Pemain %s keluar — shutdown job", participant.identity)
            ctx.shutdown("player disconnected")

    ctx.room.on("participant_disconnected", _on_participant_disconnected)

    first = rat.phases[0]
    await publisher.phase(first.id, first.label, first.advance_action_label)
    listener.start()
    # Sapaan pembuka = giliran terjadwal pemimpin Fase 1 (lewat rantai → speaker + lantai).
    discussion.start_chain(host_key, instructions=scenario.greeting_instructions)
