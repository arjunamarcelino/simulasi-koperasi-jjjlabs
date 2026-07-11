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
import { ENV } from "../../../config/env";
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
} from "../contract";

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
 * Real transport over LiveKit. Maps the wire (REST token + LiveKit event/RPC) to
 * the same SessionTransport the mock implements, so the UI is unchanged when
 * swapping mock → livekit. Wire contract: apps/backend/CONTRACT.md.
 */
export class LiveKitTransport implements SessionTransport {
  private readonly transcript = new Emitter<TranscriptItem>();
  private readonly drift = new Emitter<DriftLevel>();
  private readonly phase = new Emitter<PhaseState>();
  private readonly connection = new Emitter<WireConnectionState>();
  private readonly sessionEnded = new Emitter<SessionEnded>();
  private readonly agentReady = new Emitter<void>();
  private readonly goalReached = new Emitter<void>();

  private room: Room | null = null;
  private agentIdentity: string | null = null;
  private ended = false;
  // Synchronous latch for the manual-end path: `ended` only flips AFTER the
  // awaited end_session RPC, so two fast clicks would both pass the `ended` gate
  // and fire the RPC twice. This closes that in-flight window.
  private endingInFlight = false;
  // Set true by disconnect(). connect() checks it after every await so an
  // unmount mid-connect can never enable the mic / play audio on a dead room.
  private aborted = false;
  private seq = 0;
  private currentSpeakerName: string | undefined;
  private readonly audioEls = new Set<HTMLMediaElement>();

  async connect(scenarioId: ScenarioId): Promise<void> {
    this.connection.emit("connecting");

    const res = await fetch(`${ENV.tokenEndpoint}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario_id: scenarioId }),
    });
    if (this.aborted) return;
    if (!res.ok) {
      this.connection.emit("error");
      throw new Error(`Token endpoint gagal: ${res.status} ${res.statusText}`);
    }
    const { token, url }: TokenResponse = await res.json();
    if (this.aborted) return;

    const room = new Room();
    if (this.aborted) {
      void room.disconnect();
      return;
    }
    this.room = room;

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      this.connection.emit(CONNECTION_MAP[state]);
    });
    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      this.handleTranscription(segments, participant);
    });
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      // NPC (agent) is the only remote participant — remember its identity for RPC.
      this.markAgentReady(p.identity);
    });
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
      // Scenario goal reached (e.g. tutorial customer agreed to register) →
      // unlock the end-session action.
      if (changed["goal_reached"] === "1") this.goalReached.emit();
    });
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
    // Torn down (unmount) during the connect handshake → drop this room.
    if (this.aborted || this.room !== room) {
      void room.disconnect();
      return;
    }
    // Agent may already have joined before the handler was attached.
    const existing = room.remoteParticipants.values().next().value;
    if (existing) this.markAgentReady(existing.identity);

    // Start MUTED — the mic button is the single source of truth (store starts
    // micEnabled=false). Auto-enabling here would desync the UI (button shows
    // "off" while the mic is live) and make the mute toggle feel broken; instead
    // the first tap requests permission + unmutes from a real user gesture. Text
    // is always the fallback.
    if (this.aborted) return;
    if (!room.canPlaybackAudio) {
      try {
        await room.startAudio();
      } catch {
        // Blocked until the next gesture — see unlockAudio(). Track stays attached.
      }
    }
  }

  sendText(text: string): void {
    if (this.ended || this.aborted) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    // Echo locally so the player's text shows immediately (STT produces no
    // transcript for typed input).
    this.transcript.emit({
      id: `player-${(this.seq += 1)}`,
      speaker: "player",
      text: trimmed,
      streaming: false,
      at: Date.now(),
    });
    void this.rpc("send_text", trimmed);
  }

  async setMicEnabled(enabled: boolean): Promise<boolean> {
    if (this.ended || this.aborted) return false;
    const lp = this.room?.localParticipant;
    if (!lp) return false;
    // Actually mute/unmute (and publish on first unmute). Return the real state
    // so a denied-permission unmute reports false instead of a lying "on" icon.
    await lp.setMicrophoneEnabled(enabled);
    return lp.isMicrophoneEnabled;
  }

  /** Re-arm autoplay from a user gesture (call on any early button click). */
  unlockAudio(): void {
    void this.room?.startAudio();
  }

  async requestHint(): Promise<string> {
    if (this.ended || this.aborted) return "";
    const raw = await this.rpc("petunjuk", "");
    try {
      const { hint } = JSON.parse(raw) as { hint?: string };
      return hint ?? "";
    } catch (cause: unknown) {
      console.error("Gagal parse petunjuk:", cause);
      return "";
    }
  }

  onTranscript(cb: (item: TranscriptItem) => void): Unsubscribe {
    return this.transcript.subscribe(cb);
  }

  onDriftLevel(cb: (level: DriftLevel) => void): Unsubscribe {
    return this.drift.subscribe(cb);
  }

  onConnectionState(cb: (state: WireConnectionState) => void): Unsubscribe {
    return this.connection.subscribe(cb);
  }

  onAgentReady(cb: () => void): Unsubscribe {
    return this.agentReady.subscribe(cb);
  }

  onGoalReached(cb: () => void): Unsubscribe {
    return this.goalReached.subscribe(cb);
  }

  onSessionEnded(cb: (ended: SessionEnded) => void): Unsubscribe {
    return this.sessionEnded.subscribe(cb);
  }

  endSession(trigger: FinalDecisionTrigger = "manual"): void {
    void this.finish(trigger);
  }

  onPhase(cb: (state: PhaseState) => void): Unsubscribe {
    return this.phase.subscribe(cb);
  }

  advancePhase(): void {
    if (this.ended || this.aborted) return;
    void this.rpc("advance_phase", "");
  }

  async disconnect(): Promise<void> {
    this.aborted = true;
    const room = this.room;
    this.room = null;
    this.agentIdentity = null;
    for (const el of this.audioEls) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    this.audioEls.clear();
    // Clear emitters BEFORE awaiting disconnect so no event escapes to a torn-
    // down store during teardown.
    this.transcript.clear();
    this.drift.clear();
    this.phase.clear();
    this.connection.clear();
    this.sessionEnded.clear();
    this.agentReady.clear();
    this.goalReached.clear();
    // Explicitly release the mic before tearing down so the OS mic indicator
    // goes dark immediately on cancel/close (don't rely on disconnect alone).
    // May run on an already-torn-down participant during teardown — swallow.
    void room?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    await room?.disconnect();
  }

  // --- internal ---------------------------------------------------------

  private markAgentReady(identity: string): void {
    if (this.agentIdentity) return;
    this.agentIdentity = identity;
    this.agentReady.emit();
  }

  private async finish(trigger: FinalDecisionTrigger): Promise<void> {
    if (this.ended || this.endingInFlight) return;
    this.endingInFlight = true;
    void this.room?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    try {
      const raw = await this.rpc("end_session", "");
      const parsed = JSON.parse(raw) as SessionEnded["result"];
      if (this.ended) return; // force-quit slipped in between awaits
      this.ended = true;
      this.connection.emit("ended");
      this.sessionEnded.emit({ trigger, result: { ...parsed, trigger } });
      await this.disconnect();
    } catch (cause: unknown) {
      if (this.ended) return; // a force-quit already ended us; the reject is fallout
      console.error("RPC 'end_session' gagal:", cause);
      this.ended = true; // terminal by any door — a late data msg can't re-pop
      this.connection.emit("error");
    } finally {
      this.endingInFlight = false;
    }
  }

  private handleSessionEndedData(payload: Uint8Array): void {
    if (this.ended) return;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(payload)) as SessionEnded["result"];
      this.ended = true;
      void this.room?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
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
      this.agentIdentity ?? room?.remoteParticipants.values().next().value?.identity;
    if (!room || !destinationIdentity) {
      throw new Error("Agent NPC belum tersambung ke room.");
    }
    return room.localParticipant.performRpc({ destinationIdentity, method, payload });
  }

  private handleTranscription(
    segments: TranscriptionSegment[],
    participant?: Participant,
  ): void {
    const isPlayer = participant?.isLocal ?? false;
    for (const seg of segments) {
      // Build without `name` first, then set it conditionally — required by
      // exactOptionalPropertyTypes (never assign `name: undefined`).
      const item: TranscriptItem = {
        id: seg.id,
        speaker: isPlayer ? "player" : "npc",
        text: seg.text,
        streaming: !seg.final,
        at: Date.now(),
      };
      if (!isPlayer && this.currentSpeakerName) {
        item.name = this.currentSpeakerName;
      }
      this.transcript.emit(item);
    }
  }
}
