import { createTransport } from "./transport/createTransport";
import type {
  AuditorResult,
  DriftLevel,
  ScenarioId,
  SessionTransport,
  Unsubscribe,
} from "./transport/contract";
import { sessionStore } from "../stores/session.store";
import { gameStore } from "../stores/game.store";
import { progressRepo } from "../lib/progressRepo";

/**
 * One-way glue: Transport → store. React never reads the transport directly; it
 * only calls the actions here. (On a good-ending session finish it also pokes
 * gameStore.syncSessionBadges — a best-effort cosmetic side-channel, see persistResult.)
 *
 * A monotonic `generation` counter makes teardown race-proof: every stop()/start()
 * bumps it, and any async work (a resolving connect()) whose captured generation
 * no longer matches becomes a no-op + self-disconnect. This is what keeps
 * StrictMode double-mount and fast unmount-mid-connect from leaking a live room
 * or a hot mic.
 */
export type SessionController = {
  start: () => void;
  stop: () => void;
  startScenario: (id: ScenarioId) => void;
  sendPlayerText: (text: string) => void;
  toggleMic: () => void;
  unlockAudio: () => void;
  endSession: () => void;
  advancePhase: () => void;
  requestHint: () => void;
  dismissHint: () => void;
  restart: () => void;
  debugSetDrift: (level: DriftLevel) => void;
};

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createSessionController(): SessionController {
  let transport: SessionTransport | null = null;
  let unsubs: Unsubscribe[] = [];
  let generation = 0;
  // Persistence bookkeeping (SIM-6). `sessionStartedAt` is captured at start() so the
  // atomic record_session RPC can store a real duration. `finalizing` guarantees ONE
  // finalize per user-perceived session: set synchronously at session_ended before any
  // await, reset in stop(). It is the SOLE dedup — record_session always INSERTs (no
  // DB-level idempotency) — so a duplicate event / StrictMode remount relies on it.
  let sessionStartedAt: string | null = null;
  let finalizing = false;

  const fail = (cause: unknown): void => {
    sessionStore.getState().setError(toMessage(cause));
    sessionStore.getState().setConnection("error");
  };

  // Persist the auditor result (SIM-6) — best-effort side-channel. One atomic RPC call;
  // any failure is swallowed so persistence never disturbs the ended session or paints a
  // scrim over the ResultPanel. scenarioId comes from the result payload itself.
  const persistResult = async (result: AuditorResult): Promise<void> => {
    try {
      const outcome = await progressRepo.recordSession({
        scenarioId: result.scenarioId,
        trigger: result.trigger,
        endingType: result.endingType,
        scores: result.scores,
        state: result.stateClassification,
        feedback: result.narrativeFeedback,
        startedAt: sessionStartedAt,
      });
      if (outcome.status !== "ok") {
        console.warn("Gagal menyimpan hasil sesi:", outcome.status);
        return;
      }
      if (!outcome.data.ok) {
        console.warn("Hasil sesi ditolak:", outcome.data.reason);
        return;
      }
      // A good ending may newly earn a scenario badge; re-derive + persist (best-effort,
      // self-guarding) now that the row is committed. Assumes reads hit the primary.
      if (result.endingType === "good") void gameStore.getState().syncSessionBadges();
    } catch (cause: unknown) {
      console.warn("Gagal menyimpan hasil sesi:", cause instanceof Error ? cause.message : cause);
    }
  };

  const stop = (): void => {
    generation += 1; // invalidate anything in flight
    finalizing = false;
    for (const unsub of unsubs) unsub();
    unsubs = [];
    void transport?.disconnect();
    transport = null;
  };

  const start = (): void => {
    stop();
    sessionStartedAt = new Date().toISOString();
    const myGen = generation;
    const { getState } = sessionStore;

    // LiveKitTransport can throw SYNCHRONOUSLY from any method, so try/catch must
    // hug the whole startup, not just the promise.
    try {
      const next = createTransport();
      transport = next;

      unsubs = [
        next.onConnectionState(getState().setConnection),
        next.onTranscript(getState().upsertTranscript),
        next.onDriftLevel(getState().setDriftLevel),
        next.onSessionEnded((e) => {
          // Reset mic so the store matches the physically-released track.
          getState().setEnded(e);
          getState().setMicEnabled(false);
          // Persist the result (best-effort). Synchronous guard BEFORE any await so a
          // duplicate session_ended / StrictMode remount can't double-insert.
          if (finalizing) return;
          finalizing = true;
          void persistResult(e.result);
        }),
      ];
      if (next.onAgentReady) {
        unsubs.push(next.onAgentReady(() => getState().setAgentJoined(true)));
      }
      if (next.onGoalReached) {
        unsubs.push(next.onGoalReached(() => getState().setGoalReached(true)));
      }
      if (next.onPhase) unsubs.push(next.onPhase(getState().setPhase));

      next
        .connect(getState().scenarioId)
        .then(() => {
          // Connected after we were superseded/torn down? Undo it.
          if (myGen !== generation) void next.disconnect();
        })
        .catch((cause: unknown) => {
          if (myGen === generation) fail(cause);
        });
    } catch (cause: unknown) {
      if (myGen === generation) fail(cause);
    }
  };

  // Once the session has ended (any path), user actions must be inert — firing
  // an RPC into a torn-down room would surface a spurious error scrim over the
  // ResultPanel.
  const hasEnded = (): boolean => sessionStore.getState().ended != null;

  const guarded =
    (fn: (transport: SessionTransport) => void) =>
    (): void => {
      if (!transport || hasEnded()) return;
      try {
        fn(transport);
      } catch (cause: unknown) {
        fail(cause);
      }
    };

  return {
    start,
    stop,

    startScenario: (id: ScenarioId) => {
      stop();
      const state = sessionStore.getState();
      state.reset();
      state.setScenarioId(id);
      state.setView("SESSION");
      start();
    },

    sendPlayerText: (text: string) => {
      guarded((t) => t.sendText(text))();
    },

    toggleMic: () => {
      if (!transport || hasEnded()) return;
      const t = transport;
      const next = !sessionStore.getState().micEnabled;
      // Optimistic flip for snappy UI, then reconcile to the REAL track state the
      // transport reports (permission denied / no device → back to muted, so the
      // icon can't claim the mic is live when it isn't).
      sessionStore.getState().setMicEnabled(next);
      Promise.resolve(t.setMicEnabled(next))
        .then((actual) => sessionStore.getState().setMicEnabled(actual))
        .catch((cause: unknown) => {
          console.warn("Mic toggle gagal:", cause);
          sessionStore.getState().setMicEnabled(false);
        });
    },

    // Re-arm browser audio autoplay from a real user gesture.
    unlockAudio: () => {
      guarded((t) => t.unlockAudio?.())();
    },

    endSession: guarded((t) => t.endSession("manual")),

    advancePhase: guarded((t) => t.advancePhase?.()),

    // Hint failure must NOT drop the session (mentor is optional).
    requestHint: () => {
      if (!transport || hasEnded()) return;
      const t = transport;
      const store = sessionStore.getState();
      store.setHintLoading(true);
      const fallback = (cause: unknown): void => {
        console.error("Petunjuk gagal:", cause);
        sessionStore
          .getState()
          .setHint("Mentor belum siap menjawab. Coba lagi sebentar lagi.");
      };
      try {
        t.requestHint()
          .then((hint) =>
            sessionStore.getState().setHint(hint || "Belum ada petunjuk untuk saat ini."),
          )
          .catch(fallback)
          .finally(() => sessionStore.getState().setHintLoading(false));
      } catch (cause: unknown) {
        fallback(cause);
        sessionStore.getState().setHintLoading(false);
      }
    },

    dismissHint: () => sessionStore.getState().setHint(null),

    restart: () => {
      stop();
      sessionStore.getState().reset();
      start();
    },

    debugSetDrift: (level: DriftLevel) => {
      guarded((t) => t.debugSetDrift?.(level))();
    },
  };
}
