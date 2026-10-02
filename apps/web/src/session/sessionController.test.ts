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
}));

vi.mock("./transport/createTransport", () => ({
  createTransport: () => ({
    onConnectionState: () => () => {},
    onTranscript: () => () => {},
    onDriftLevel: () => () => {},
    onSessionEnded: (cb: (e: SessionEnded) => void) => {
      h.sessionEndedCb = cb;
      return () => {};
    },
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
  }),
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

const RESULT: AuditorResult = {
  scenarioId: "kredit-macet",
  trigger: "manual",
  stateClassification: { foo: "BENAR" },
  scores: { compliance: 80 },
  endingType: "good",
  narrativeFeedback: "Bagus",
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
