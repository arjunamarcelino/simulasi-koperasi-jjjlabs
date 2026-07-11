import { useCallback, useEffect, useState, type ReactNode } from "react";
import { gameStore, useGameStore } from "../../stores/game.store";
import { sessionStore, useSessionStore } from "../../stores/session.store";
import { sessionController } from "../../session/controller";
import { SCENARIOS } from "../../scenarios/scenario.config";
import type { EvidenceContent, EvidenceTone, ScenarioConfig } from "../../types/scenario";
import type { ScenarioId } from "../../session/transport/contract";
import { PixelPanel } from "../common/PixelPanel";
import { GameButton } from "../common/GameButton";
import { ResultPanel } from "./ResultPanel";
import { BigCharacter } from "./BigCharacter";
import { DialogueBox } from "./DialogueBox";
import { ActionRail } from "./ActionRail";
import { SessionStatusBar } from "./SessionStatusBar";

/** Wall-clock (ms) to wait for the NPC agent to join before giving up (LiveKit). */
const AGENT_JOIN_TIMEOUT_MS = 25000;

/**
 * Visual-novel voice session, layered over the live koperasi map (the player is
 * frozen by the scene while activeOverlay === "SESSION"). Ports SessionPage's
 * state machine — idle gesture → connecting → ready VN → ended/error — and only
 * reshapes the "ready" layout into two big characters + a dialogue box + an
 * action rail. Every exit routes through clearSelection so the scene unfreezes.
 */
export function SessionOverlay() {
  const scenarioId = useGameStore((s) => s.selectedScenarioId);
  const config = SCENARIOS.find((sc) => sc.id === scenarioId) ?? null;

  const connection = useSessionStore((s) => s.connection);
  const agentJoined = useSessionStore((s) => s.agentJoined);
  const goalReached = useSessionStore((s) => s.goalReached);
  const micEnabled = useSessionStore((s) => s.micEnabled);
  const ended = useSessionStore((s) => s.ended);
  const error = useSessionStore((s) => s.error);
  const transcript = useSessionStore((s) => s.transcript);
  const driftLevel = useSessionStore((s) => s.driftLevel);
  const phase = useSessionStore((s) => s.phase);
  const hint = useSessionStore((s) => s.hint);
  const hintLoading = useSessionStore((s) => s.hintLoading);

  // Briefing opens by default so the player sees the mission before talking.
  // Evidence ("Periksa Bukti") is a second left panel; the two are mutually
  // exclusive so they never overlap.
  const [showBriefing, setShowBriefing] = useState(true);
  const [showEvidence, setShowEvidence] = useState(false);
  const toggleBriefing = useCallback(() => {
    setShowBriefing((v) => {
      if (!v) setShowEvidence(false);
      return !v;
    });
  }, []);
  const toggleEvidence = useCallback(() => {
    setShowEvidence((v) => {
      if (!v) setShowBriefing(false);
      return !v;
    });
  }, []);

  // Tear the session down + unfreeze the player. stop() here is immediate (mic
  // release); the unmount effect calls it again — idempotent via the gen token.
  const close = useCallback(() => {
    sessionController.stop();
    gameStore.getState().clearSelection();
  }, []);

  // Mount: clean slate + scenario id. Unmount: stop. NEVER auto-connect here —
  // connecting only happens from the explicit "Mulai" gesture (StrictMode-safe).
  useEffect(() => {
    if (!scenarioId) return;
    sessionStore.getState().reset();
    sessionStore.getState().setScenarioId(scenarioId as ScenarioId);
    return () => sessionController.stop();
  }, [scenarioId]);

  // Esc closes from ANY sub-state. Capture-phase on document so it beats Phaser's
  // global key polling and stays consistent with the other hub overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [close]);

  // Agent-join watchdog: the room reports "connected" ~12-19s before the agent
  // actually joins; if it never does, surface an error instead of hanging on the
  // spinner forever. (Mock joins instantly, so this only bites on a dead backend.)
  useEffect(() => {
    if (agentJoined || ended || error) return;
    if (connection !== "connecting" && connection !== "connected") return;
    const id = window.setTimeout(() => {
      const s = sessionStore.getState();
      if (!s.agentJoined && !s.ended) {
        s.setError("Agen NPC tidak merespons. Pastikan backend berjalan, lalu coba lagi.");
      }
    }, AGENT_JOIN_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [connection, agentJoined, ended, error]);

  if (!config || !scenarioId) return null; // unknown id — openSession pre-guards this

  const npcName = config.npcName ?? "Pelanggan";
  const endLabel = config.endActionLabel ?? "Keputusan Akhir";
  // Re-gate on connection so actions disable the instant a live pipe drops.
  const ready = agentJoined && connection !== "ended" && connection !== "error";
  // The end action is locked until the scenario goal is reached (for scenarios
  // that declare a goal signal); others can end once ready.
  const canEnd = !config.gatesEndOnGoal || goalReached;

  const start = () => {
    sessionController.startScenario(scenarioId as ScenarioId);
    sessionController.unlockAudio();
  };
  const send = (text: string) => {
    sessionController.unlockAudio();
    sessionController.sendPlayerText(text);
  };
  const toggleMic = () => {
    sessionController.unlockAudio();
    sessionController.toggleMic();
  };

  // --- terminal / pre-conversation states ----------------------------------

  if (ended) {
    return (
      <div className="absolute inset-0 z-40">
        <ResultPanel ended={ended} onBack={close} />
      </div>
    );
  }

  if (error) {
    return (
      <Scrim>
        <PixelPanel className="max-w-sm text-center">
          <p className="mb-4 font-body text-xl text-orange">{error}</p>
          <div className="flex justify-center gap-3">
            <GameButton variant="ghost" onClick={close}>
              ◀ Kembali
            </GameButton>
            <GameButton variant="primary" onClick={start}>
              Coba Lagi
            </GameButton>
          </div>
        </PixelPanel>
      </Scrim>
    );
  }

  // Connection dropped mid-session with no result payload — a dead end, so give
  // it an explicit door rather than a broken "ready" layout.
  if (connection === "ended") {
    return (
      <Scrim>
        <PixelPanel className="max-w-sm text-center">
          <p className="mb-4 font-body text-xl text-ink">
            Koneksi ke NPC terputus. Sesi diakhiri.
          </p>
          <GameButton variant="primary" onClick={close}>
            ◀ Kembali ke Kantor Koperasi
          </GameButton>
        </PixelPanel>
      </Scrim>
    );
  }

  if (connection === "idle") {
    return (
      <Scrim>
        <SessionStatusBar
          npcName={npcName}
          driftLevel={driftLevel}
          connection={connection}
          onClose={close}
        />
        <PixelPanel className="max-w-sm text-center">
          <p className="mb-4 font-body text-xl text-ink-soft">
            Tekan untuk menyapa {npcName} dan mengaktifkan mikrofon.
          </p>
          <GameButton variant="primary" onClick={start}>
            ▶ Mulai Percakapan
          </GameButton>
        </PixelPanel>
      </Scrim>
    );
  }

  if (!ready) {
    return (
      <Scrim>
        <SessionStatusBar
          npcName={npcName}
          driftLevel={driftLevel}
          connection={connection}
          onClose={close}
        />
        <PixelPanel className="max-w-sm text-center">
          <p className="animate-pulse font-body text-xl text-ink-soft">
            Menyambungkan ke {npcName}…
          </p>
        </PixelPanel>
      </Scrim>
    );
  }

  // --- ready: the visual-novel scene ---------------------------------------

  const visible = transcript.filter((t) => t.speaker !== "system");
  const line = visible.at(-1) ?? null;
  const systemNote =
    [...transcript].reverse().find((t) => t.speaker === "system")?.text ?? null;
  const activeSpeaker: "player" | "npc" = line?.speaker === "player" ? "player" : "npc";

  return (
    <div className="absolute inset-0 z-30 flex select-none flex-col overflow-hidden">
      {/* Low scrim at the top (map stays visible), darker toward the bottom so the
          actors + dialogue box read against it. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/30 to-ink/5" />

      <SessionStatusBar
        npcName={npcName}
        driftLevel={driftLevel}
        connection={connection}
        onClose={close}
      />

      {/* Actors, bottom-anchored above the dialogue box. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-8 pb-[200px] md:px-24">
        <BigCharacter role="npc" active={activeSpeaker === "npc"} />
        <BigCharacter role="player" active={activeSpeaker === "player"} />
      </div>

      <ActionRail
        ready={ready}
        endLabel={endLabel}
        hintLoading={hintLoading}
        phase={phase}
        canEnd={canEnd}
        hasEvidence={!!config.evidence}
        onHint={() => sessionController.requestHint()}
        onToggleBriefing={toggleBriefing}
        onCheckEvidence={toggleEvidence}
        onAdvancePhase={() => sessionController.advancePhase()}
        onEnd={() => sessionController.endSession()}
      />

      {hint && (
        <HintBanner text={hint} onDismiss={() => sessionController.dismissHint()} />
      )}

      {showBriefing && (
        <BriefingPanel config={config} onClose={() => setShowBriefing(false)} />
      )}

      {showEvidence && config.evidence && (
        <EvidencePanel evidence={config.evidence} onClose={() => setShowEvidence(false)} />
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 p-3">
        <DialogueBox
          line={line}
          systemNote={systemNote}
          npcName={npcName}
          ready={ready}
          frozen={false}
          micEnabled={micEnabled}
          onSend={send}
          onToggleMic={toggleMic}
        />
      </div>
    </div>
  );
}

/** Full-screen dimmed backdrop centering a card — used for the non-VN states. */
function Scrim({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/60 p-4">
      {children}
    </div>
  );
}

/** Prominent pixel close button (matches the mading boards' ✕). */
function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pixel-raise active:pixel-press absolute -right-2 -top-2 z-10 flex h-8 w-8 select-none items-center justify-center bg-mustard font-display text-[11px] text-ink focus-visible:pixel-focus focus-visible:outline-none"
    >
      ✕
    </button>
  );
}

/** In-session hint, top-center. Pixel banner, dismissible. */
function HintBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto absolute left-1/2 top-20 z-30 w-full max-w-md -translate-x-1/2 px-3">
      <div className="pixel-panel relative flex items-start gap-2 bg-mustard p-3 pr-4 text-ink animate-[lineIn_140ms_ease-out]">
        <CloseButton onClick={onDismiss} label="Tutup petunjuk" />
        <span aria-hidden="true" className="font-display text-[10px]">
          💡
        </span>
        <p className="flex-1 font-body text-lg leading-snug">{text}</p>
      </div>
    </div>
  );
}

const EVIDENCE_TONE: Record<EvidenceTone, string> = {
  good: "text-forest",
  bad: "text-orange",
  neutral: "text-ink",
};

/**
 * "Periksa Bukti" — the koperasi's static case file, toggled from the rail.
 * Styled as a dossier (parchment + brown, tabular rows) so it never reads like
 * the briefing "scroll". Content only; it does NOT reveal the force-majeure
 * cause — the player must draw that out in conversation.
 */
function EvidencePanel({ evidence, onClose }: { evidence: EvidenceContent; onClose: () => void }) {
  return (
    <div className="pointer-events-auto absolute left-3 top-20 z-30 w-full max-w-sm">
      <div className="pixel-panel relative bg-parchment text-left animate-[lineIn_140ms_ease-out]">
        <CloseButton onClick={onClose} label="Tutup bukti" />
        {evidence.eyebrow && (
          <p className="font-display text-[8px] tracking-wide text-ink-soft">{evidence.eyebrow}</p>
        )}
        <h2 className="mb-2 flex items-center gap-1.5 pr-6 font-display text-[11px] text-brown">
          <span aria-hidden="true">📁</span>
          {evidence.title}
        </h2>
        <dl className="divide-y divide-ink-soft/20 border-t-2 border-border">
          {evidence.items.map((item) => (
            <div key={item.label} className="py-2">
              <dt className="font-display text-[8px] tracking-wide text-ink-soft">{item.label}</dt>
              <dd className={`font-body text-lg leading-snug ${EVIDENCE_TONE[item.tone ?? "neutral"]}`}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Scenario briefing (mission + steps), toggled by the Deskripsi rail button. */
function BriefingPanel({ config, onClose }: { config: ScenarioConfig; onClose: () => void }) {
  return (
    <div className="pointer-events-auto absolute left-3 top-20 z-30 w-full max-w-sm">
      <PixelPanel className="relative text-left animate-[lineIn_140ms_ease-out]">
        <CloseButton onClick={onClose} label="Tutup deskripsi" />
        <div className="mb-2 flex items-center justify-between gap-2 pr-6">
          <h2 className="font-display text-[11px] text-forest">{config.title}</h2>
        </div>
        {config.mission && (
          <p className="mb-3 font-body text-lg leading-snug text-ink">{config.mission}</p>
        )}
        {config.steps && config.steps.length > 0 && (
          <ol className="space-y-1.5 font-body text-lg leading-snug text-ink-soft">
            {config.steps.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-display text-[9px] text-mustard">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </PixelPanel>
    </div>
  );
}
