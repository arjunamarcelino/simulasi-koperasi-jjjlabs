import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type TranscriptionSegment,
} from "livekit-client";
import { ENV } from "../../config/env";
import type {
  ConnectionState as WireConnectionState,
  DriftLevel,
  FinalDecisionTrigger,
  PhaseState,
  ScenarioId,
  SessionEnded,
  SessionTransport,
  TranscriptItem,
  Unsubscribe,
} from "../contract.provisional";

type TokenResponse = { token: string; room: string; url: string };

class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  subscribe(cb: (value: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(value: T): void {
    for (const cb of [...this.listeners]) cb(value);
  }
  clear(): void {
    this.listeners.clear();
  }
}

const CONNECTION_MAP: Record<ConnectionState, WireConnectionState> = {
  [ConnectionState.Disconnected]: "ended",
  [ConnectionState.Connecting]: "connecting",
  [ConnectionState.Connected]: "connected",
  [ConnectionState.Reconnecting]: "connecting",
  [ConnectionState.SignalReconnecting]: "connecting",
};

/**
 * Implementasi transport nyata di atas LiveKit. Memetakan wire (token REST +
 * event/RPC LiveKit) ke `SessionTransport` yang sama dipakai MockTransport,
 * sehingga UI tidak berubah sedikit pun saat menukar mock → livekit.
 *
 * Cakupan kini = Skenario 1 (Tutorial): STT/LLM/TTS + RPC "bayar_daftar" &
 * "send_text". Drift & fase belum dipakai (skenario lain menyusul).
 */
export class LiveKitTransport implements SessionTransport {
  private readonly transcript = new Emitter<TranscriptItem>();
  private readonly drift = new Emitter<DriftLevel>();
  private readonly phase = new Emitter<PhaseState>();
  private readonly connection = new Emitter<WireConnectionState>();
  private readonly sessionEnded = new Emitter<SessionEnded>();

  private room: Room | null = null;
  private agentIdentity: string | null = null;
  private ended = false;
  private seq = 0;
  // Nama pembicara NPC terkini (dari data message "speaker"). Sumber kebenaran
  // identitas pembicara — penting untuk RAT (dua NPC) & game (tampilkan karakter).
  private currentSpeakerName: string | undefined;
  // Elemen <audio> untuk memutar suara agent. livekit-client mentah tidak
  // memutar track remote otomatis — kita harus attach sendiri.
  private readonly audioEls = new Set<HTMLMediaElement>();

  async connect(scenarioId: ScenarioId): Promise<void> {
    this.connection.emit("connecting");

    const res = await fetch(`${ENV.tokenEndpoint}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario_id: scenarioId }),
    });
    if (!res.ok) {
      this.connection.emit("error");
      throw new Error(`Token endpoint gagal: ${res.status} ${res.statusText}`);
    }
    const { token, url }: TokenResponse = await res.json();

    const room = new Room();
    this.room = room;

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      this.connection.emit(CONNECTION_MAP[state]);
    });
    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      this.handleTranscription(segments, participant);
    });
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      // NPC (agent) adalah satu-satunya peserta remote — simpan identity-nya
      // untuk tujuan RPC.
      this.agentIdentity ??= p.identity;
    });
    // INI yang membuat suara agent terdengar: attach track audio ke <audio>.
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
      this.audioEls.add(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      for (const el of track.detach()) {
        el.remove();
        this.audioEls.delete(el);
      }
    });
    // Drift real-time (Lapisan 2) + fase RAT → participant attributes.
    room.on(RoomEvent.ParticipantAttributesChanged, (changed) => {
      const rawDrift = changed["drift_level"];
      if (rawDrift !== undefined) {
        const level = Number(rawDrift);
        if (level === 0 || level === 1 || level === 2) this.drift.emit(level);
      }
      const rawPhase = changed["phase"];
      if (rawPhase !== undefined) {
        try {
          this.phase.emit(JSON.parse(rawPhase) as PhaseState);
        } catch (cause: unknown) {
          console.error("Gagal parse phase:", cause);
        }
      }
    });
    // Data message dari agent: hasil Auditor (force-quit) & identitas pembicara.
    room.on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
      if (topic === "session_ended") {
        this.handleSessionEndedData(payload);
      } else if (topic === "speaker") {
        try {
          const { name } = JSON.parse(new TextDecoder().decode(payload)) as {
            name?: string;
          };
          this.currentSpeakerName = name;
        } catch (cause: unknown) {
          console.error("Gagal parse speaker:", cause);
        }
      }
    });

    await room.connect(url, token);
    // Agent bisa jadi sudah tersambung sebelum handler terpasang.
    this.agentIdentity ??=
      room.remoteParticipants.values().next().value?.identity ?? null;

    // Mic adalah jalur utama tapi TIDAK wajib — teks adalah fallback (PRD
    // Prinsip 4). Kegagalan mic (izin ditolak / tak ada perangkat) tak boleh
    // menjatuhkan sesi.
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (cause: unknown) {
      console.warn("Mic tidak aktif, lanjut lewat teks:", cause);
    }
    // Buka kunci autoplay audio (aman dipanggil setelah gesture klik kartu).
    if (!room.canPlaybackAudio) {
      try {
        await room.startAudio();
      } catch {
        // Diblokir browser sampai gesture berikutnya — track tetap ter-attach.
      }
    }
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Echo lokal agar teks pemain langsung tampil (STT tak menghasilkan
    // transkrip untuk input teks).
    this.transcript.emit({
      id: `player-${(this.seq += 1)}`,
      speaker: "player",
      text: trimmed,
      streaming: false,
      at: Date.now(),
    });
    void this.rpc("send_text", trimmed);
  }

  setMicEnabled(enabled: boolean): void {
    void this.room?.localParticipant.setMicrophoneEnabled(enabled);
  }

  onTranscript(cb: (item: TranscriptItem) => void): Unsubscribe {
    return this.transcript.subscribe(cb);
  }

  onDriftLevel(cb: (level: DriftLevel) => void): Unsubscribe {
    // Skenario 1 tanpa observer; emitter ini tak pernah menyala.
    return this.drift.subscribe(cb);
  }

  onConnectionState(cb: (state: WireConnectionState) => void): Unsubscribe {
    return this.connection.subscribe(cb);
  }

  onSessionEnded(cb: (ended: SessionEnded) => void): Unsubscribe {
    return this.sessionEnded.subscribe(cb);
  }

  endSession(trigger: FinalDecisionTrigger = "manual"): void {
    void this.finish(trigger);
  }

  // Fase RAT (Skenario 4) — attribute "phase" + RPC "advance_phase".
  onPhase(cb: (state: PhaseState) => void): Unsubscribe {
    return this.phase.subscribe(cb);
  }

  advancePhase(): void {
    void this.rpc("advance_phase", "");
  }

  // debugSetDrift sengaja tidak diimplementasikan (alat mock saja).

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.agentIdentity = null;
    for (const el of this.audioEls) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    this.audioEls.clear();
    this.transcript.clear();
    this.drift.clear();
    this.phase.clear();
    this.connection.clear();
    this.sessionEnded.clear();
    await room?.disconnect();
  }

  // --- internal ---------------------------------------------------------

  private async finish(trigger: FinalDecisionTrigger): Promise<void> {
    if (this.ended) return;
    // Sesi berakhir: matikan mic SEKETIKA agar tak ada input suara lagi,
    // sebelum menunggu balasan RPC.
    void this.room?.localParticipant.setMicrophoneEnabled(false);
    try {
      const raw = await this.rpc("end_session", "");
      const parsed = JSON.parse(raw) as SessionEnded["result"];
      if (this.ended) return; // force-quit menyalip di antara await
      this.ended = true;
      this.connection.emit("ended");
      this.sessionEnded.emit({ trigger, result: { ...parsed, trigger } });
      // Putuskan room total — hentikan audio agent & lepas mic sepenuhnya.
      await this.disconnect();
    } catch (cause: unknown) {
      // endSession dipanggil fire-and-forget, jadi jangan lempar ke atas —
      // tangani sendiri agar tak jadi unhandled rejection.
      console.error("RPC 'end_session' gagal:", cause);
      this.connection.emit("error");
    }
  }

  /** Force-quit Level 2: agent mengirim hasil Auditor lewat data message. */
  private handleSessionEndedData(payload: Uint8Array): void {
    if (this.ended) return;
    try {
      const parsed = JSON.parse(
        new TextDecoder().decode(payload),
      ) as SessionEnded["result"];
      this.ended = true;
      void this.room?.localParticipant.setMicrophoneEnabled(false);
      this.connection.emit("ended");
      this.sessionEnded.emit({ trigger: parsed.trigger, result: parsed });
      void this.disconnect();
    } catch (cause: unknown) {
      console.error("Gagal memproses hasil force-quit:", cause);
    }
  }

  private async rpc(method: string, payload: string): Promise<string> {
    const room = this.room;
    const destinationIdentity =
      this.agentIdentity ??
      room?.remoteParticipants.values().next().value?.identity;
    if (!room || !destinationIdentity) {
      throw new Error("Agent NPC belum tersambung ke room.");
    }
    return room.localParticipant.performRpc({
      destinationIdentity,
      method,
      payload,
    });
  }

  private handleTranscription(
    segments: TranscriptionSegment[],
    participant?: Participant,
  ): void {
    const isPlayer = participant?.isLocal ?? false;
    for (const seg of segments) {
      const item: TranscriptItem = {
        id: seg.id,
        speaker: isPlayer ? "player" : "npc",
        text: seg.text,
        streaming: !seg.final,
        at: Date.now(),
      };
      // Label NPC dari sinyal "speaker" (bukan participant.name yang kosong).
      if (!isPlayer && this.currentSpeakerName) {
        item.name = this.currentSpeakerName;
      }
      this.transcript.emit(item);
    }
  }
}
