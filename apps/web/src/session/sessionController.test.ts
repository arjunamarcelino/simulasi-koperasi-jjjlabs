import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditorResult, SessionEnded } from "./transport/contract";

// The controller is the sole orchestrator of session persistence (SIM-6). These tests
// drive a fake transport (we capture its onSessionEnded callback) with progressRepo
// mocked, and assert the open-at-end flow, the synchronous idempotency guard, degraded
// no-op, best-effort swallowing, and replay. Node env, no jsdom — the session store is
// pure logic.

const h = vi.hoisted(() => ({
  sessionEndedCb: null as ((e: SessionEnded) => void) | null,
  openSession: vi.fn(),
  recordSessionResult: vi.fn(),
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
  progressRepo: { openSession: h.openSession, recordSessionResult: h.recordSessionResult },
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

/** Drain the microtask queue for persistResult's chained awaits (no timers involved). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  h.sessionEndedCb = null;
  h.openSession.mockReset();
  h.recordSessionResult.mockReset();
  h.openSession.mockResolvedValue({ status: "ok", data: { id: "s1" } });
  h.recordSessionResult.mockResolvedValue({ status: "ok", data: { ok: true, sessionId: "s1" } });
  sessionStore.getState().reset();
});

afterEach(() => {
  sessionStore.getState().reset();
});

describe("sessionController persistence", () => {
  it("opens then finalizes exactly one row on session end (happy path)", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.openSession).toHaveBeenCalledTimes(1);
    expect(h.openSession).toHaveBeenCalledWith("kredit-macet");
    expect(h.recordSessionResult).toHaveBeenCalledTimes(1);
    expect(h.recordSessionResult).toHaveBeenCalledWith({
      sessionId: "s1",
      trigger: "manual",
      endingType: "good",
      scores: { compliance: 80 },
      state: { foo: "BENAR" },
      feedback: "Bagus",
    });
  });

  it("is idempotent: a duplicate session_ended does not open a second row", async () => {
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    h.sessionEndedCb?.(ENDED); // duplicate (e.g. LiveKit redelivery / StrictMode)
    await flush();

    expect(h.openSession).toHaveBeenCalledTimes(1);
    expect(h.recordSessionResult).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when degraded (openSession returns degraded)", async () => {
    h.openSession.mockResolvedValue({ status: "degraded" });
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.openSession).toHaveBeenCalledTimes(1);
    expect(h.recordSessionResult).not.toHaveBeenCalled();
  });

  it("is best-effort: a persistence rejection never disturbs the ended session", async () => {
    h.openSession.mockRejectedValue(new Error("boom"));
    const controller = createSessionController();
    controller.startScenario("kredit-macet");
    await flush();

    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.recordSessionResult).not.toHaveBeenCalled();
    // The session still ended cleanly — no error scrim, result is shown.
    expect(sessionStore.getState().ended).toEqual(ENDED);
    expect(sessionStore.getState().error).toBeNull();
  });

  it("persists a fresh row on replay (finalizing resets on restart)", async () => {
    const controller = createSessionController();

    controller.startScenario("kredit-macet");
    await flush();
    h.sessionEndedCb?.(ENDED);
    await flush();

    controller.startScenario("kredit-macet"); // play again → stop() resets finalizing
    await flush();
    h.sessionEndedCb?.(ENDED);
    await flush();

    expect(h.openSession).toHaveBeenCalledTimes(2);
    expect(h.recordSessionResult).toHaveBeenCalledTimes(2);
  });
});
