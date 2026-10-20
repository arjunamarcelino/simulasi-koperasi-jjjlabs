import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditorResult, SessionEnded } from "./transport/contract";

// The controller is the sole orchestrator of session persistence (SIM-6). These tests
// drive a fake transport (we capture its onSessionEnded callback) with progressRepo
// mocked, and assert the single atomic record_session call, the synchronous idempotency
// guard, degraded/business-failure handling, best-effort swallowing, and replay. Node
// env, no jsdom — the session store is pure logic.

const h = vi.hoisted(() => ({
  sessionEndedCb: null as ((e: SessionEnded) => void) | null,
  recordSession: vi.fn(),
  syncSessionBadges: vi.fn(),
  listMySessions: vi.fn(),
  driftCb: null as ((level: 0 | 1 | 2) => void) | null,
  connectionCb: null as ((state: string) => void) | null,
  endSessionCalls: [] as unknown[][],
  requestHint: vi.fn(),
  connectArgs: [] as unknown[][],
  transport: "mock" as "mock" | "livekit",
}));

vi.mock("./transport/createTransport", () => ({
  createTransport: () => ({
    onConnectionState: (cb: (state: string) => void) => {
      h.connectionCb = cb;
      return () => {};
    },
    onTranscript: () => () => {},
    onDriftLevel: (cb: (level: 0 | 1 | 2) => void) => {
      h.driftCb = cb;
      return () => {};
    },
    endSession: (...args: unknown[]) => {
      h.endSessionCalls.push(args);
    },
    requestHint: h.requestHint,
    onSessionEnded: (cb: (e: SessionEnded) => void) => {
      h.sessionEndedCb = cb;
      return () => {};
    },
    connect: (...args: unknown[]) => {
      h.connectArgs.push(args);
      return Promise.resolve();
    },
    disconnect: () => Promise.resolve(),
  }),
}));

vi.mock("../config/env", () => ({
  ENV: {
    get transport() {
      return h.transport;
    },
  },
}));

vi.mock("../lib/sessionsRepo", () => ({
  sessionsRepo: { listMySessions: h.listMySessions },
}));

vi.mock("../lib/progressRepo", () => ({
  progressRepo: { recordSession: h.recordSession },
}));

// Isolate the controller: the badge side-channel is exercised at the store level
// (game.store.test.ts); here we only assert the controller TRIGGERS it correctly.
vi.mock("../stores/game.store", () => ({
  gameStore: { getState: () => ({ syncSessionBadges: h.syncSessionBadges }) },
}));

import { createSessionController } from "./sessionController";
import { sessionStore } from "../stores/session.store";
import type { SessionRecord } from "../lib/sessionsRepo.contracts";

const RESULT: AuditorResult = {
  scenarioId: "kredit-macet",
  trigger: "manual",
  stateClassification: { foo: "BENAR" },
  scores: { compliance: 80 },
  endingType: "good",
  narrativeFeedback: "Bagus",
  values: { kepedulian: { status: "TERCERMIN", evidence: "Bertanya dulu.", trend: "MENGUAT" } },
  progressFeedback: "Berkembang.",
  nextStep: "Tetap santun.",
  evaluationFailed: false,
};
const ENDED: SessionEnded = { trigger: "manual", result: RESULT };
const ENDED_NEUTRAL: SessionEnded = {
  trigger: "manual",
  result: { ...RESULT, endingType: "neutral" },
};

/** Drain the microtask queue for persistResult's awaits (no timers involved). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  h.sessionEndedCb = null;
  h.recordSession.mockReset();
  h.recordSession.mockResolvedValue({ status: "ok", data: { ok: true } });
  h.syncSessionBadges.mockReset();
  h.listMySessions.mockReset();
  h.listMySessions.mockResolvedValue({ status: "ok", data: [] });
  h.connectArgs = [];
  h.endSessionCalls = [];
  h.requestHint.mockReset();
  h.requestHint.mockResolvedValue("hint mentor");
  h.driftCb = null;
  h.connectionCb = null;
  h.transport = "mock";
  sessionStore.getState().reset();
});

afterEach(() => {
  sessionStore.getState().reset();
});

describe("sessionController persistence", () => {
  it("records the session once via the atomic RPC on session end", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.recordSession).toHaveBeenCalledTimes(1);
    expect(h.recordSession).toHaveBeenCalledWith({
      scenarioId: "kredit-macet", // sourced from e.result, not the store
      trigger: "manual",
      endingType: "good",
      scores: { compliance: 80 },
      state: { foo: "BENAR" },
      feedback: "Bagus",
      values: RESULT.values,
      progressFeedback: "Berkembang.",
      nextStep: "Tetap santun.",
      startedAt: expect.any(String), // captured at start()
    });
  });

  it("is idempotent: a duplicate session_ended does not record twice", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    h.sessionEndedCb?.(ENDED); // duplicate (redelivery / StrictMode)
    await flush();

    expect(h.recordSession).toHaveBeenCalledTimes(1);
  });

  it("handles a degraded outcome without disturbing the session", async () => {
    h.recordSession.mockResolvedValue({ status: "degraded" });
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.recordSession).toHaveBeenCalledTimes(1);
    expect(sessionStore.getState().ended).toEqual(ENDED);
    expect(sessionStore.getState().error).toBeNull();
  });

  it("handles a business rejection ({ok:false}) without disturbing the session", async () => {
    h.recordSession.mockResolvedValue({ status: "ok", data: { ok: false, reason: "invalid" } });
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(sessionStore.getState().ended).toEqual(ENDED);
    expect(sessionStore.getState().error).toBeNull();
  });

  it("is best-effort: a rejection never disturbs the ended session", async () => {
    h.recordSession.mockRejectedValue(new Error("boom"));
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(sessionStore.getState().ended).toEqual(ENDED);
    expect(sessionStore.getState().error).toBeNull();
  });

  it("records a fresh session on replay (finalizing resets on restart)", async () => {
    const controller = createSessionController();

    controller.startScenario("kredit-macet");
    await flush();
    h.sessionEndedCb?.(ENDED);
    await flush();

    controller.startScenario("kredit-macet"); // play again → stop() resets finalizing
    await flush();
    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.recordSession).toHaveBeenCalledTimes(2);
  });
});

describe("sessionController — session-badge sync trigger", () => {
  it("triggers the badge sync once on a good-ending success", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.syncSessionBadges).toHaveBeenCalledTimes(1);
  });

  it("does not trigger the sync for a non-good ending", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED_NEUTRAL);
    await flush();

    expect(h.recordSession).toHaveBeenCalledTimes(1); // still recorded
    expect(h.syncSessionBadges).not.toHaveBeenCalled();
  });

  it("does not trigger the sync when the record is rejected ({ok:false})", async () => {
    h.recordSession.mockResolvedValue({ status: "ok", data: { ok: false, reason: "invalid" } });
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.syncSessionBadges).not.toHaveBeenCalled();
  });

  it("does not trigger the sync on a degraded record outcome", async () => {
    h.recordSession.mockResolvedValue({ status: "degraded" });
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.syncSessionBadges).not.toHaveBeenCalled();
  });

  it("triggers the sync at most once on a duplicate session_ended", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    h.sessionEndedCb?.(ENDED); // redelivery / StrictMode remount
    await flush();

    // The badge sync piggybacks on the same `finalizing` guard that dedups recordSession.
    expect(h.recordSession).toHaveBeenCalledTimes(1);
    expect(h.syncSessionBadges).toHaveBeenCalledTimes(1);
  });
});

describe("sessionController — personal-feedback history for the auditor", () => {
  const ASSESSED: SessionRecord = {
    id: "s1",
    scenarioId: "kredit-macet",
    startedAt: Date.parse("2026-10-18T09:00:00.000Z"),
    endingType: "bad",
    trigger: "manual",
    scores: {},
    stateClassification: {},
    narrativeFeedback: "",
    values: { kepedulian: { status: "DIABAIKAN", evidence: "Langsung menagih.", trend: "BARU_DIUJI" } },
    progressFeedback: "",
    nextStep: "Tanyakan sebab kesulitannya dulu.",
  };

  it("livekit: passes the player's value history to connect", async () => {
    h.transport = "livekit";
    h.listMySessions.mockResolvedValue({ status: "ok", data: [ASSESSED] });
    createSessionController().startScenario("keanggotaan-fiktif");
    await flush();

    expect(h.connectArgs).toEqual([
      [
        "keanggotaan-fiktif",
        {
          history: [
            {
              scenario_id: "kredit-macet",
              played_on: "2026-10-18",
              values: { kepedulian: { status: "DIABAIKAN", evidence: "Langsung menagih." } },
              next_step: "Tanyakan sebab kesulitannya dulu.",
            },
          ],
        },
      ],
    ]);
  });

  it("mock transport: never loads history (offline-first)", async () => {
    createSessionController().startScenario("kredit-macet");
    await flush();

    expect(h.listMySessions).not.toHaveBeenCalled();
    expect(h.connectArgs).toEqual([["kredit-macet", { history: [] }]]);
  });

  it("tutorial: never loads history (it has no auditor)", async () => {
    h.transport = "livekit";
    createSessionController().startScenario("tutorial-koperasi-konsumen");
    await flush();

    expect(h.listMySessions).not.toHaveBeenCalled();
    expect(h.connectArgs).toEqual([["tutorial-koperasi-konsumen", { history: [] }]]);
  });

  it("a failed history read still starts the session, without history", async () => {
    h.transport = "livekit";
    h.listMySessions.mockRejectedValue(new Error("offline"));
    createSessionController().startScenario("kredit-macet");
    await flush();

    expect(h.connectArgs).toEqual([["kredit-macet", { history: [] }]]);
    expect(sessionStore.getState().error).toBeNull();
  });

  it("a slow history read never holds the session start past the timeout", async () => {
    vi.useFakeTimers();
    try {
      h.transport = "livekit";
      h.listMySessions.mockReturnValue(new Promise(() => {})); // never settles
      createSessionController().startScenario("kredit-macet");
      await flush();
      expect(h.connectArgs).toEqual([]);

      await vi.advanceTimersByTimeAsync(1500);
      expect(h.connectArgs).toEqual([["kredit-macet", { history: [] }]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not connect a transport superseded while history was loading", async () => {
    h.transport = "livekit";
    let release: (v: unknown) => void = () => {};
    h.listMySessions.mockReturnValue(new Promise((r) => (release = r)));
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    controller.stop(); // player left before the history read returned

    release({ status: "ok", data: [ASSESSED] });
    await flush();
    expect(h.connectArgs).toEqual([]);
  });
});

describe("sessionController — 'sedang menyusun evaluasi' state", () => {
  const started = async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();
    return controller;
  };

  it("ending the session shows the evaluating state right away", async () => {
    const controller = await started();
    controller.endSession();

    expect(h.endSessionCalls).toEqual([["manual"]]);
    expect(sessionStore.getState().evaluating).toBe(true);
  });

  it("a force-quit (drift level 2) also shows the evaluating state", async () => {
    await started();
    h.driftCb?.(2);

    expect(sessionStore.getState().driftLevel).toBe(2);
    expect(sessionStore.getState().evaluating).toBe(true);
  });

  it("a drift warning (level 1) does not", async () => {
    await started();
    h.driftCb?.(1);

    expect(sessionStore.getState().evaluating).toBe(false);
  });

  it("the result replaces the evaluating state", async () => {
    const controller = await started();
    controller.endSession();
    h.sessionEndedCb?.(ENDED);

    expect(sessionStore.getState().evaluating).toBe(false);
    expect(sessionStore.getState().ended).toEqual(ENDED);
  });

  it("a dropped connection while evaluating surfaces an error instead of hanging", async () => {
    const controller = await started();
    controller.endSession();
    h.connectionCb?.("error");

    expect(sessionStore.getState().evaluating).toBe(false);
    expect(sessionStore.getState().error).toMatch(/evaluasi/i);
  });

  it("a connection error outside evaluation keeps today's behavior (no error message)", async () => {
    await started();
    h.connectionCb?.("error");

    expect(sessionStore.getState().connection).toBe("error");
    expect(sessionStore.getState().error).toBeNull();
  });
});

describe("sessionController — failed evaluation", () => {
  const FAILED: SessionEnded = {
    trigger: "manual",
    result: {
      ...RESULT,
      stateClassification: {},
      scores: {},
      endingType: "neutral",
      narrativeFeedback: "Evaluasi otomatis tidak dapat diselesaikan.",
      values: {},
      progressFeedback: "",
      nextStep: "",
      evaluationFailed: true,
    },
  };

  it("still shows the fallback result panel", async () => {
    createSessionController().startScenario("kredit-macet");
    await flush();
    h.sessionEndedCb?.(FAILED);
    await flush();

    expect(sessionStore.getState().ended).toEqual(FAILED);
    expect(sessionStore.getState().evaluating).toBe(false);
  });

  it("never stores it in the database (nor syncs badges)", async () => {
    createSessionController().startScenario("kredit-macet");
    await flush();
    h.sessionEndedCb?.(FAILED);
    await flush();

    expect(h.recordSession).not.toHaveBeenCalled();
    expect(h.syncSessionBadges).not.toHaveBeenCalled();
  });
});

describe("sessionController — local hints (open-the-file nudge)", () => {
  it("shows a local hint without asking the mentor", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    controller.showHint("Buka 'Periksa Bukti' dulu.");

    expect(sessionStore.getState().hint).toBe("Buka 'Periksa Bukti' dulu.");
    expect(h.requestHint).not.toHaveBeenCalled();
  });

  it("is a no-op once the session has ended", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();
    h.sessionEndedCb?.(ENDED);

    controller.showHint("Buka 'Periksa Bukti' dulu.");

    expect(sessionStore.getState().hint).toBeNull();
  });
});
