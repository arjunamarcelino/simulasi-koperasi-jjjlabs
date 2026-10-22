import { useCallback, useEffect, useReducer, useState, type ReactNode } from "react";
import { gameStore, useGameStore } from "../../stores/game.store";
import { sessionStore, useSessionStore } from "../../stores/session.store";
import { sessionController } from "../../session/controller";
import { SCENARIOS } from "../../scenarios/scenario.config";
import type { EvidenceContent, EvidenceGuide } from "../../types/scenario";
import type { ScenarioId } from "../../session/transport/contract";
import { PixelPanel } from "../common/PixelPanel";
import { GameButton } from "../common/GameButton";
import { ResultPanel } from "./ResultPanel";
import { EvaluatingPanel } from "./EvaluatingPanel";
import { BigCharacter } from "./BigCharacter";
import { DialogueBox } from "./DialogueBox";
import { ActionRail } from "./ActionRail";
import { SessionStatusBar } from "./SessionStatusBar";
import { CloseButton } from "./CloseButton";
import { BriefingPanel } from "./BriefingPanel";
import { EvidenceDossier, EvidencePanel } from "./EvidencePanel";
import { completedPlayerTurns, evidenceStepIndex, shouldRemindEvidence } from "./evidenceGuide";
import { INITIAL_PANELS, panelsReducer } from "./sessionPanels";

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
  const evaluating = useSessionStore((s) => s.evaluating);
  const error = useSessionStore((s) => s.error);
  const transcript = useSessionStore((s) => s.transcript);
  const driftLevel = useSessionStore((s) => s.driftLevel);
  const phase = useSessionStore((s) => s.phase);
  const hint = useSessionStore((s) => s.hint);
  const hintLoading = useSessionStore((s) => s.hintLoading);

  // Briefing opens by default so the player sees the mission before talking.
  // Evidence ("Periksa Bukti") is a second left panel; the two are mutually
  // exclusive so they never overlap, and closing the file returns to the panel it
  // replaced (the briefing it was opened from).
  const [panels, dispatchPanels] = useReducer(panelsReducer, INITIAL_PANELS);
  const showBriefing = panels.open === "briefing";
  const showEvidence = panels.open === "evidence";
  // Open-the-file guide (scenarios whose evidence declares one): nudges stop once the
  // player has opened the file — in session or on the pre-session card. Local state,
  // not the store: startScenario() resets the store after a pre-session read.
  const [evidenceOpened, setEvidenceOpened] = useState(false);
  const [showPreEvidence, setShowPreEvidence] = useState(false);
  const [reminded, setReminded] = useState(false);
  const [evidencePopKey, setEvidencePopKey] = useState(0);
  const toggleBriefing = useCallback(() => dispatchPanels("toggleBriefing"), []);
  const toggleEvidence = useCallback(() => {
    // Toggling either opens the file or closes one already open — opened either way.
    setEvidenceOpened(true);
    dispatchPanels("toggleEvidence");
  }, []);
  const openPreEvidence = useCallback(() => {
    setShowPreEvidence(true);
    setEvidenceOpened(true);
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

  const guide = config?.evidence?.guide ?? null;
  const nudgingEvidence = !!guide && !evidenceOpened;
  const playerTurns = completedPlayerTurns(transcript);

  // Point the player at the file (local hint, no mentor RPC) + pop its rail button.
  const pointToEvidence = useCallback((g: EvidenceGuide) => {
    setReminded(true); // a nudge already seen makes the one-shot reminder redundant
    setEvidencePopKey((k) => k + 1);
    sessionController.showHint(g.nudge);
  }, []);

  // One-shot reminder: the player has been talking without opening the file.
  useEffect(() => {
    if (!guide) return;
    const due = shouldRemindEvidence({
      hasGuide: true,
      opened: evidenceOpened,
      reminded,
      hintShowing: hint !== null,
      playerTurns,
    });
    if (due) pointToEvidence(guide);
  }, [guide, evidenceOpened, reminded, hint, playerTurns, pointToEvidence]);

  // Once the file is open, a lingering "open the file" hint is stale — clear it.
  useEffect(() => {
    if (evidenceOpened && guide && sessionStore.getState().hint === guide.nudge) {
      sessionController.dismissHint();
    }
  }, [evidenceOpened, guide]);

  if (!config || !scenarioId) return null; // unknown id — openSession pre-guards this

  const npcName = config.npcName ?? "Pelanggan";
  // Multi-NPC (RAT) capability: two personas staged at once → 3-slot layout.
  const npcNames = config.npcNames;
  const multiNpc = !!npcNames && npcNames.length >= 2;
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

  // The session is ending and the auditor is assessing it. A pipe that drops meanwhile
  // falls through to the error / "terputus" doors below instead of waiting forever.
  if (evaluating && connection !== "ended" && connection !== "error") {
    return (
      <Scrim>
        <EvaluatingPanel />
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
        <PixelPanel className={`${showPreEvidence ? "max-w-md" : "max-w-sm"} text-center`}>
          <p className="mb-4 font-body text-xl text-ink-soft">
            Tekan untuk menyapa {npcName} dan mengaktifkan mikrofon.
          </p>
          <GameButton variant="primary" onClick={start}>
            ▶ Mulai Percakapan
          </GameButton>
          {config.evidence && guide && (
            <PreSessionEvidence
              evidence={config.evidence}
              guide={guide}
              open={showPreEvidence}
              onOpen={openPreEvidence}
            />
          )}
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
        <PixelPanel className={`${showPreEvidence ? "max-w-md" : "max-w-sm"} text-center`}>
          <p className="animate-pulse font-body text-xl text-ink-soft">
            Menyambungkan ke {npcName}…
          </p>
          {/* The agent can take ~15s to join — spend the wait reading the case file. */}
          {config.evidence && guide && (
            <PreSessionEvidence
              evidence={config.evidence}
              guide={guide}
              open={showPreEvidence}
              onOpen={openPreEvidence}
            />
          )}
        </PixelPanel>
      </Scrim>
    );
  }

  // --- ready: the visual-novel scene ---------------------------------------

  const visible = transcript.filter((t) => t.speaker !== "system");
  const line = visible.at(-1) ?? null;
  const systemNote =
    [...transcript].reverse().find((t) => t.speaker === "system")?.text ?? null;
  const playerActive = line?.speaker === "player";
  // For the multi-NPC stage, the active persona is matched by the last line's
  // `name` label; single-NPC scenarios just toggle the one npc slot.
  const activeNpcName = !playerActive && line ? (line.name ?? null) : null;
  const fileStep = config.evidence ? evidenceStepIndex(config.steps, config.evidence.title) : -1;

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

      {/* Actors, bottom-anchored above the dialogue box. RAT stages two NPCs on
          the left (each name-plated so the pair is distinguishable), player right. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-8 pb-[200px] md:px-24">
        {multiNpc && npcNames ? (
          <div className="flex items-end gap-5 md:gap-10">
            <NpcActor
              role="npc"
              name={npcNames[0] ?? ""}
              active={activeNpcName === npcNames[0]}
            />
            <NpcActor
              role="npc-alt"
              name={npcNames[1] ?? ""}
              active={activeNpcName === npcNames[1]}
            />
          </div>
        ) : (
          <BigCharacter role="npc" active={!playerActive} />
        )}
        <BigCharacter role="player" active={playerActive} />
      </div>

      <ActionRail
        ready={ready}
        endLabel={endLabel}
        hintLoading={hintLoading}
        phase={phase}
        canEnd={canEnd}
        nudgeEnd={driftLevel >= 1 && canEnd}
        hasEvidence={!!config.evidence}
        evidenceLabel={config.evidence?.title ?? "Periksa Bukti"}
        nudgeEvidence={nudgingEvidence}
        // The briefing already points at the file; the coachmark takes over once it closes.
        evidenceCallout={guide && nudgingEvidence && !showBriefing ? guide.callout : null}
        evidencePopKey={evidencePopKey}
        // Until the file is opened, Petunjuk points at it locally instead of asking the mentor.
        onHint={() =>
          guide && nudgingEvidence ? pointToEvidence(guide) : sessionController.requestHint()
        }
        onToggleBriefing={toggleBriefing}
        onCheckEvidence={toggleEvidence}
        onAdvancePhase={() => sessionController.advancePhase()}
        onEnd={() => sessionController.endSession()}
      />

      {hint && (
        <HintBanner text={hint} onDismiss={() => sessionController.dismissHint()} />
      )}

      {showBriefing && (
        <BriefingPanel
          config={config}
          onClose={() => dispatchPanels("closeBriefing")}
          evidenceAction={
            guide && config.evidence && fileStep >= 0
              ? {
                  stepIndex: fileStep,
                  label: config.evidence.title,
                  opened: evidenceOpened,
                  onOpen: toggleEvidence,
                }
              : undefined
          }
        />
      )}

      {showEvidence && config.evidence && (
        <EvidencePanel evidence={config.evidence} onClose={() => dispatchPanels("closeEvidence")} />
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 p-3">
        <DialogueBox
          line={line}
          systemNote={systemNote}
          npcName={npcName}
          ready={ready}
          frozen={false}
          micEnabled={micEnabled}
          npcRole={multiNpc && npcNames && activeNpcName === npcNames[1] ? "npc-alt" : "npc"}
          onSend={send}
          onToggleMic={toggleMic}
        />
      </div>
    </div>
  );
}

/**
 * One name-plated NPC in the multi-NPC (RAT) stage. The plate above the sprite is
 * the load-bearing cue for telling two same-side personas apart; it brightens for
 * the active speaker while the sprite itself dims/steps back via BigCharacter.
 */
function NpcActor({
  role,
  name,
  active,
}: {
  role: "npc" | "npc-alt";
  name: string;
  active: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`whitespace-nowrap border-2 px-1.5 py-0.5 font-display text-[8px] transition-opacity duration-200 ${
          active
            ? "border-border bg-mustard text-ink opacity-100"
            : "border-border/50 bg-cream/80 text-ink-soft opacity-70"
        }`}
      >
        {name}
      </span>
      <BigCharacter role={role} active={active} />
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

/**
 * Case file on the pre-conversation cards ("Mulai" / "Menyambungkan…"): a prompt +
 * button, expanding in place into the dossier so the player reads it before talking.
 */
function PreSessionEvidence({
  evidence,
  guide,
  open,
  onOpen,
}: {
  evidence: EvidenceContent;
  guide: EvidenceGuide;
  open: boolean;
  onOpen: () => void;
}) {
  if (open) {
    return (
      <div className="mt-4 max-h-[50dvh] overflow-y-auto border-3 border-border bg-parchment p-4 text-left">
        <EvidenceDossier evidence={evidence} />
      </div>
    );
  }
  return (
    <div className="mt-4 border-t-2 border-ink-soft/20 pt-3">
      <p className="mb-2 font-body text-lg leading-snug text-ink">
        <span aria-hidden="true">📁 </span>
        {guide.callout}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="pixel-raise active:pixel-press bg-cream px-3 py-2 font-display text-[9px] text-forest focus-visible:pixel-focus focus-visible:outline-none"
      >
        Baca berkas dulu
      </button>
    </div>
  );
}
