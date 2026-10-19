import { describe, expect, it } from "vitest";
// `?raw` inlines the backend auditor so the two halves of one timing contract are checked
// together (same technique as scenario.config.parity.test.ts).
import auditorSource from "../../../../../backend/voice_worker/evaluation/auditor.py?raw";
import type { ValueHistoryEntry } from "../contract";
import { END_SESSION_RPC_TIMEOUT_MS, parseAuditorResult, tokenRequestBody } from "./wire";

// Pure wire helpers of the LiveKit transport: the untrusted auditor payload is narrowed
// (and the personal-feedback fields normalized so an older worker stays compatible), and
// the /token body carries the player's value history only when there is one.

const BASE = {
  scenarioId: "kredit-macet",
  trigger: "manual",
  stateClassification: { State_Jalur_Remedi: "SESUAI" },
  scores: { compliance: 80 },
  endingType: "good",
  narrativeFeedback: "Bagus.",
};

const VALUES = {
  kepedulian: { status: "TERCERMIN", evidence: "Menanyakan kabar warung.", trend: "MENGUAT" },
};

describe("parseAuditorResult", () => {
  it("passes a full result through", () => {
    const full = {
      ...BASE,
      values: VALUES,
      progressFeedback: "Berkembang.",
      nextStep: "Tanya dulu.",
      evaluationFailed: false,
    };
    expect(parseAuditorResult(full)).toEqual(full);
  });

  it("fills empty personal feedback when an older worker omits the fields", () => {
    expect(parseAuditorResult(BASE)).toEqual({
      ...BASE,
      values: {},
      progressFeedback: "",
      nextStep: "",
      evaluationFailed: false,
    });
  });

  it("normalizes malformed personal-feedback fields instead of rejecting the result", () => {
    const parsed = parseAuditorResult({ ...BASE, values: "rusak", progressFeedback: 7, nextStep: null });
    expect(parsed).toEqual({
      ...BASE,
      values: {},
      progressFeedback: "",
      nextStep: "",
      evaluationFailed: false,
    });
  });

  it("carries the worker's failed-evaluation mark", () => {
    expect(parseAuditorResult({ ...BASE, evaluationFailed: true })?.evaluationFailed).toBe(true);
  });

  it("treats anything but a literal true as not failed", () => {
    expect(parseAuditorResult({ ...BASE, evaluationFailed: "true" })?.evaluationFailed).toBe(false);
  });

  it.each([null, "x", { ...BASE, narrativeFeedback: 1 }, { ...BASE, scores: [] }])(
    "rejects a payload missing the core envelope (%p)",
    (raw) => {
      expect(parseAuditorResult(raw)).toBeNull();
    },
  );
});

describe("tokenRequestBody", () => {
  const entry: ValueHistoryEntry = {
    scenario_id: "kredit-macet",
    played_on: "2026-10-18",
    values: { kepedulian: { status: "DIABAIKAN", evidence: "Langsung menagih." } },
    next_step: "Tanyakan sebab kesulitannya dulu.",
  };

  it("sends only the scenario when there is no history", () => {
    expect(tokenRequestBody("kredit-macet", [])).toEqual({ scenario_id: "kredit-macet" });
  });

  it("includes the history when present", () => {
    expect(tokenRequestBody("keanggotaan-fiktif", [entry])).toEqual({
      scenario_id: "keanggotaan-fiktif",
      history: [entry],
    });
  });
});

describe("END_SESSION_RPC_TIMEOUT_MS ↔ backend auditor budget", () => {
  // LiveKit cancels the worker's end_session handler at the caller's timeout, so the
  // auditor's whole retry/fallback budget must finish (with margin) before it.
  const budget = /^_AUDIT_BUDGET_S\s*=\s*([\d.]+)/m.exec(auditorSource)?.[1];

  it("fail-loud guard: found the backend budget", () => {
    expect(budget).toBeDefined();
  });

  it("outlasts the auditor budget by at least 5 s", () => {
    expect(END_SESSION_RPC_TIMEOUT_MS).toBeGreaterThanOrEqual(Number(budget) * 1000 + 5000);
  });
});
