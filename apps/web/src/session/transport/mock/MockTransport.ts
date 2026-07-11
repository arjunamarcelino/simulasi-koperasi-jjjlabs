import type {
  AuditorResult,
  ConnectionState,
  DriftLevel,
  FinalDecisionTrigger,
  PhaseState,
  ScenarioId,
  SessionEnded,
  SessionTransport,
  TranscriptItem,
  Unsubscribe,
} from "../contract";
import type {
  RatConfig,
  RatPhaseDef,
  ScenarioScript,
  ScriptTurn,
} from "./scripts/script.types";
import { TUTORIAL_SCRIPT } from "./scripts/tutorial.script";
import { KREDIT_MACET_SCRIPT } from "./scripts/kredit-macet.script";
import { KEANGGOTAAN_FIKTIF_SCRIPT } from "./scripts/keanggotaan-fiktif.script";

// Scenarios plug in here as their scripts land.
const SCRIPTS: Partial<Record<ScenarioId, ScenarioScript>> = {
  "tutorial-koperasi-konsumen": TUTORIAL_SCRIPT,
  "kredit-macet": KREDIT_MACET_SCRIPT,
  "keanggotaan-fiktif": KEANGGOTAAN_FIKTIF_SCRIPT,
};

const CONNECT_DELAY_MS = 400;
const THINK_MIN_MS = 500;
const THINK_MAX_MS = 900;
const STREAM_TICK_MS = 28;
const CHARS_PER_TICK = 2;

/** Minimal emitter: enough for every stream, no dependency. */
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

/**
 * Scripted transport for validating the UI without a backend. The generic bits
 * (partial→final streaming, drift keywords, force-quit, ending selection) serve
 * every scenario. RAT (`script.rat`) adds a two-persona / phase machine on top —
 * dead code until a RAT script is registered, harmless meanwhile.
 */
export class MockTransport implements SessionTransport {
  private readonly transcript = new Emitter<TranscriptItem>();
  private readonly drift = new Emitter<DriftLevel>();
  private readonly connection = new Emitter<ConnectionState>();
  private readonly sessionEnded = new Emitter<SessionEnded>();
  private readonly phase = new Emitter<PhaseState>();
  private readonly agentReady = new Emitter<void>();
  private readonly goalReached = new Emitter<void>();
  private goalEmitted = false;

  private readonly timers = new Set<number>();

  private script: ScenarioScript | null = null;
  private turnIndex = 0;
  private driftScore = 0;
  private driftLevel: DriftLevel = 0;
  private ended = false;
  private disposed = false;
  private npcBusy = false;
  private seq = 0;
  private hintCursor = 0;

  // --- RAT-only state ---
  private phaseIndex = 0;
  private activePersonaKey: string | null = null;
  private readonly ratCursor = new Map<string, number>();

  connect(scenarioId: ScenarioId): Promise<void> {
    const script = SCRIPTS[scenarioId];
    if (!script) {
      this.connection.emit("error");
      return Promise.reject(
        new Error(`MockTransport belum punya skrip untuk skenario "${scenarioId}".`),
      );
    }

    this.script = script;
    this.turnIndex = 0;
    this.driftScore = 0;
    this.driftLevel = 0;
    this.ended = false;
    this.disposed = false;
    this.hintCursor = 0;
    this.phaseIndex = 0;
    this.activePersonaKey = null;
    this.ratCursor.clear();
    this.goalEmitted = false;

    this.connection.emit("connecting");

    return new Promise((resolve) => {
      this.later(() => {
        this.connection.emit("connected");
        // The mock "agent" is ready as soon as it connects.
        this.agentReady.emit();
        this.drift.emit(0);

        if (script.rat) {
          this.activePersonaKey = this.phaseDefaultPersona(script.rat, 1);
          this.emitPhase();
        }

        this.streamTurn(script.greeting);
        resolve();
      }, CONNECT_DELAY_MS);
    });
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.ended || this.disposed || !this.script || this.driftLevel === 2) {
      return;
    }

    this.transcript.emit({
      id: this.nextId("player"),
      speaker: "player",
      text: trimmed,
      streaming: false,
      at: Date.now(),
    });

    if (this.evaluateDrift(trimmed) === 2) {
      this.forceQuit();
      return;
    }

    if (this.npcBusy) return;

    const isLinear = !this.script.rat;
    const turn = isLinear
      ? this.nextLinearTurn()
      : this.nextRatTurn(this.script.rat!, trimmed);
    if (!turn) return;
    // nextLinearTurn() advanced turnIndex; the turn just taken is turnIndex - 1.
    const playedIndex = isLinear ? this.turnIndex - 1 : -1;

    const think = THINK_MIN_MS + Math.random() * Math.max(0, THINK_MAX_MS - THINK_MIN_MS);
    this.npcBusy = true;
    this.later(() => this.streamTurn(turn, () => this.maybeEmitGoal(playedIndex)), think);
  }

  /** Fire the goal signal once, when the scripted goal turn finishes streaming. */
  private maybeEmitGoal(turnIndex: number): void {
    if (this.goalEmitted || this.script?.goalAtTurn === undefined) return;
    if (turnIndex !== this.script.goalAtTurn) return;
    this.goalEmitted = true;
    this.goalReached.emit();
  }

  requestHint(): Promise<string> {
    const hints = this.script?.hints;
    if (!hints || hints.length === 0) {
      return Promise.resolve(
        "Coba dengarkan dulu kebutuhan lawan bicara, lalu jelaskan langkah " +
          "yang sesuai dengan tujuan skenario ini.",
      );
    }
    const hint = hints[Math.min(this.hintCursor, hints.length - 1)] ?? "";
    this.hintCursor += 1;
    return Promise.resolve(hint);
  }

  setMicEnabled(enabled: boolean): Promise<boolean> {
    if (this.ended || this.disposed) return Promise.resolve(false);
    this.transcript.emit({
      id: this.nextId("system"),
      speaker: "system",
      text: enabled ? "Mic dinyalakan (mock — tidak merekam)." : "Mic dimatikan.",
      streaming: false,
      at: Date.now(),
    });
    return Promise.resolve(enabled);
  }

  onTranscript(cb: (item: TranscriptItem) => void): Unsubscribe {
    return this.transcript.subscribe(cb);
  }

  onDriftLevel(cb: (level: DriftLevel) => void): Unsubscribe {
    return this.drift.subscribe(cb);
  }

  onConnectionState(cb: (state: ConnectionState) => void): Unsubscribe {
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

  onPhase(cb: (state: PhaseState) => void): Unsubscribe {
    return this.phase.subscribe(cb);
  }

  endSession(trigger: FinalDecisionTrigger = "manual"): void {
    this.finishSession(trigger);
  }

  advancePhase(): void {
    const rat = this.script?.rat;
    if (!rat || this.ended || this.disposed) return;
    if (this.phaseIndex >= rat.phases.length - 1) return;

    this.phaseIndex += 1;
    const phase = rat.phases[this.phaseIndex];
    if (!phase) return;

    this.activePersonaKey = this.phaseDefaultPersona(rat, phase.id);
    this.emitPhase();

    this.transcript.emit({
      id: this.nextId("system"),
      speaker: "system",
      text: `Fase ${phase.id}: ${phase.label}.`,
      streaming: false,
      at: Date.now(),
    });

    if (phase.entryEvent) {
      const name = this.personaName(rat, phase.entryEvent.personaKey);
      this.streamTurn({ name, text: phase.entryEvent.text });
    }
  }

  debugSetDrift(level: DriftLevel): void {
    if (this.ended || this.disposed || !this.script) return;
    const config = this.script.drift;
    if (config) {
      this.driftScore = level === 2 ? config.level2At : level === 1 ? config.level1At : 0;
    }
    this.setLevel(level);
    if (level === 2) this.forceQuit();
  }

  disconnect(): Promise<void> {
    this.disposed = true;
    this.npcBusy = false;
    this.clearTimers();
    this.transcript.clear();
    this.drift.clear();
    this.connection.clear();
    this.sessionEnded.clear();
    this.phase.clear();
    this.agentReady.clear();
    this.goalReached.clear();
    return Promise.resolve();
  }

  // --- drift (generic) --------------------------------------------------

  private evaluateDrift(playerText: string): DriftLevel {
    const config = this.script?.drift;
    if (!config) return this.driftLevel;

    const lower = playerText.toLowerCase();
    const escalated = config.escalate.some((word) => lower.includes(word));
    const deescalated = config.deescalate.some((word) => lower.includes(word));

    if (escalated) this.driftScore += 1;
    else if (deescalated) this.driftScore = Math.max(0, this.driftScore - 1);

    const level: DriftLevel =
      this.driftScore >= config.level2At ? 2 : this.driftScore >= config.level1At ? 1 : 0;
    this.setLevel(level);
    return level;
  }

  private setLevel(level: DriftLevel): void {
    if (level === this.driftLevel) return;
    this.driftLevel = level;
    this.drift.emit(level);
  }

  // --- session end (generic) --------------------------------------------

  private forceQuit(): void {
    if (this.ended || this.disposed) return;
    this.clearTimers();
    this.npcBusy = false;

    const line = this.script?.forceQuitLine;
    const finalize = () => this.finishSession("force_quit_level_2");
    if (line) this.streamTurn(line, finalize);
    else finalize();
  }

  private finishSession(trigger: FinalDecisionTrigger): void {
    if (this.ended || this.disposed || !this.script) return;
    this.ended = true;
    this.npcBusy = false;
    this.clearTimers();

    this.transcript.emit({
      id: this.nextId("system"),
      speaker: "system",
      text:
        trigger === "force_quit_level_2"
          ? "Sesi dihentikan otomatis — ketegangan mencapai level maksimum."
          : "Keputusan Akhir diambil. Sesi dievaluasi.",
      streaming: false,
      at: Date.now(),
    });

    this.connection.emit("ended");
    this.sessionEnded.emit({ trigger, result: this.pickEnding(trigger) });
  }

  private pickEnding(trigger: FinalDecisionTrigger): AuditorResult {
    const endings = this.script!.endings;
    const wantBad = trigger === "force_quit_level_2" || this.driftLevel >= 1;
    const chosen = wantBad && endings.bad ? endings.bad : endings.good;
    return { ...chosen, trigger };
  }

  // --- linear flow ------------------------------------------------------

  private nextLinearTurn(): ScriptTurn | null {
    if (!this.script) return null;
    const turns = this.script.npcTurns;
    if (turns.length === 0) return null;
    const index = Math.min(this.turnIndex, turns.length - 1);
    this.turnIndex = index + 1;
    return turns[index] ?? null;
  }

  // --- RAT flow ---------------------------------------------------------

  private phaseDefaultPersona(rat: RatConfig, phaseId: 1 | 2 | 3): string {
    return rat.phaseDefaultPersona?.[phaseId] ?? rat.defaultPersonaKey;
  }

  private currentRatPhase(): RatPhaseDef | null {
    return this.script?.rat?.phases[this.phaseIndex] ?? null;
  }

  private emitPhase(): void {
    const phase = this.currentRatPhase();
    if (!phase) return;
    this.phase.emit({
      phase: phase.id,
      label: phase.label,
      advanceActionLabel: phase.advanceActionLabel,
    });
  }

  private personaName(rat: RatConfig, key: string): string {
    return rat.personas.find((p) => p.key === key)?.name ?? key;
  }

  private resolveResponder(rat: RatConfig, playerText: string): string {
    const lower = playerText.toLowerCase();
    for (const [keyword, personaKey] of Object.entries(rat.nameMentions)) {
      if (lower.includes(keyword)) {
        this.activePersonaKey = personaKey;
        return personaKey;
      }
    }
    const phase = this.currentRatPhase();
    return (
      this.activePersonaKey ??
      (phase ? this.phaseDefaultPersona(rat, phase.id) : rat.defaultPersonaKey)
    );
  }

  private nextRatTurn(rat: RatConfig, playerText: string): ScriptTurn | null {
    const phase = this.currentRatPhase();
    if (!phase) return null;

    const personaKey = this.resolveResponder(rat, playerText);
    const lines = phase.turns[personaKey] ?? [];
    if (lines.length === 0) return null;

    const cursorKey = `${phase.id}:${personaKey}`;
    const cursor = this.ratCursor.get(cursorKey) ?? 0;
    const index = Math.min(cursor, lines.length - 1);
    this.ratCursor.set(cursorKey, index + 1);

    const text = lines[index];
    if (text === undefined) return null;
    return { name: this.personaName(rat, personaKey), text };
  }

  // --- streaming & util (generic) ---------------------------------------

  private streamTurn(turn: ScriptTurn, onDone?: () => void): void {
    if (this.ended || this.disposed) {
      this.npcBusy = false;
      return;
    }

    const id = this.nextId("npc");
    const at = Date.now();
    let cursor = 0;

    const tick = (): void => {
      if (this.ended || this.disposed) {
        this.npcBusy = false;
        return;
      }

      cursor = Math.min(cursor + CHARS_PER_TICK, turn.text.length);
      const done = cursor >= turn.text.length;

      this.transcript.emit({
        id,
        speaker: "npc",
        name: turn.name,
        text: turn.text.slice(0, cursor),
        streaming: !done,
        at,
      });

      if (done) {
        this.npcBusy = false;
        onDone?.();
        return;
      }
      this.later(tick, STREAM_TICK_MS);
    };

    this.npcBusy = true;
    tick();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
  }
}
