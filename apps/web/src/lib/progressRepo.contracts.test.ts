import { describe, expect, it } from "vitest";
import {
  parseClaimMission,
  parseLeaderboardCurrent,
  parseMyProgress,
  parseQuizCatalog,
  parseReconcile,
  parseRecordSession,
  parseRedeemVoucher,
  parseSubmitQuiz,
} from "./progressRepo.contracts";

// These parsers are the entire type-soundness boundary: postgREST hands back
// unvalidated Json, so a malformed shape MUST parse to null (never a bad object).

describe("parseClaimMission", () => {
  it("parses success with reward + totals", () => {
    expect(parseClaimMission({ ok: true, reward: { xp: 20, point: 20 }, totals: { xp: 70, point: 60 } })).toEqual(
      { ok: true, reward: { xp: 20, point: 20 }, totals: { xp: 70, point: 60 } },
    );
  });
  it("parses known failure reasons", () => {
    expect(parseClaimMission({ ok: false, reason: "wrong-code" })).toEqual({ ok: false, reason: "wrong-code" });
    expect(parseClaimMission({ ok: false, reason: "already" })).toEqual({ ok: false, reason: "already" });
  });
  it("rejects malformed / unknown shapes", () => {
    expect(parseClaimMission({ ok: true, reward: { xp: 1 } })).toBeNull(); // missing point + totals
    expect(parseClaimMission({ ok: false, reason: "nope" })).toBeNull();
    expect(parseClaimMission(null)).toBeNull();
    expect(parseClaimMission("x")).toBeNull();
  });
});

describe("parseRedeemVoucher", () => {
  it("parses success + failure", () => {
    expect(parseRedeemVoucher({ ok: true, code: "KDMP-1", balance: 40 })).toEqual({ ok: true, code: "KDMP-1", balance: 40 });
    expect(parseRedeemVoucher({ ok: false, reason: "insufficient" })).toEqual({ ok: false, reason: "insufficient" });
  });
  it("rejects malformed", () => {
    expect(parseRedeemVoucher({ ok: true, code: "x" })).toBeNull(); // missing balance
    expect(parseRedeemVoucher({ ok: false, reason: "weird" })).toBeNull();
  });
});

describe("parseSubmitQuiz", () => {
  it("parses success incl. a null explanation and already_credited remap", () => {
    const r = parseSubmitQuiz({
      ok: true,
      awarded: { xp: 10, point: 10 },
      totals: { xp: 30, point: 30 },
      results: [{ code: "q01", correct: true, explanation: null, already_credited: true }],
    });
    expect(r).toEqual({
      ok: true,
      awarded: { xp: 10, point: 10 },
      totals: { xp: 30, point: 30 },
      results: [{ code: "q01", correct: true, explanation: null, alreadyCredited: true }],
    });
  });
  it("parses failure reasons + rejects malformed rows", () => {
    expect(parseSubmitQuiz({ ok: false, reason: "too_many" })).toEqual({ ok: false, reason: "too_many" });
    expect(parseSubmitQuiz({ ok: true, awarded: { xp: 0, point: 0 }, totals: { xp: 0, point: 0 }, results: "nope" })).toBeNull();
    expect(parseSubmitQuiz({ ok: true, awarded: { xp: 0, point: 0 }, totals: { xp: 0, point: 0 }, results: [{ code: "q1" }] })).toBeNull();
  });
});

describe("parseReconcile", () => {
  it("splits applied / already / mismatch", () => {
    expect(parseReconcile({ ok: true, totals: { xp: 40, point: 0 } })).toEqual({ ok: true, applied: true, totals: { xp: 40, point: 0 } });
    expect(parseReconcile({ ok: true, skipped: "already" })).toEqual({ ok: true, applied: false });
    expect(parseReconcile({ ok: false, reason: "uid_mismatch" })).toEqual({ ok: false, reason: "uid_mismatch" });
  });
  it("rejects malformed", () => {
    expect(parseReconcile({ ok: true })).toBeNull(); // neither totals nor skipped
    expect(parseReconcile({ ok: false, reason: "other" })).toBeNull();
  });
});

describe("parseMyProgress", () => {
  it("parses a full snapshot", () => {
    const r = parseMyProgress({
      progress: { xp: 50, point: 30 },
      missions: ["keliling"],
      vouchers: [{ voucherId: "belanja-5k", name: "Belanja", code: "KDMP-1", redeemedAt: 1000 }],
      badges: ["penjelajah"],
    });
    expect(r?.xp).toBe(50);
    expect(r?.vouchers.length).toBe(1);
  });
  it("treats a null progress row as a zeroed wallet (new account)", () => {
    const r = parseMyProgress({ progress: null, missions: [], vouchers: [], badges: [] });
    expect(r).toEqual({ xp: 0, point: 0, missions: [], vouchers: [], badges: [] });
  });
  it("rejects malformed", () => {
    expect(parseMyProgress({ progress: { xp: 1, point: 2 }, missions: "x", vouchers: [], badges: [] })).toBeNull();
    expect(parseMyProgress({ progress: { xp: 1, point: 2 }, missions: [], vouchers: [{ bad: true }], badges: [] })).toBeNull();
    expect(parseMyProgress(null)).toBeNull();
  });
});

describe("parseQuizCatalog", () => {
  it("parses rows + rejects malformed", () => {
    expect(parseQuizCatalog([{ code: "q1", prompt: "P", options: ["a", "b"] }])).toEqual([
      { code: "q1", prompt: "P", options: ["a", "b"] },
    ]);
    expect(parseQuizCatalog("nope")).toBeNull();
    expect(parseQuizCatalog([{ code: "q1", prompt: "P", options: [1, 2] }])).toBeNull();
  });
});

describe("parseLeaderboardCurrent", () => {
  it("parses a valid array and strips any echoed user_id", () => {
    expect(
      parseLeaderboardCurrent([
        { display_name: "Budi", xp: 120, level: 3, rank: 1, user_id: "uuid" },
        { display_name: "Siti", xp: 80, level: 2, rank: 2 },
      ]),
    ).toEqual([
      { display_name: "Budi", xp: 120, level: 3, rank: 1 },
      { display_name: "Siti", xp: 80, level: 2, rank: 2 },
    ]);
  });
  it("accepts an empty array (no season yet)", () => {
    expect(parseLeaderboardCurrent([])).toEqual([]);
  });
  it("rejects malformed shapes", () => {
    expect(parseLeaderboardCurrent("nope")).toBeNull();
    expect(parseLeaderboardCurrent(null)).toBeNull();
    expect(parseLeaderboardCurrent([{ display_name: "Budi", xp: 10, level: 2 }])).toBeNull(); // missing rank
    expect(parseLeaderboardCurrent([{ display_name: 5, xp: 10, level: 2, rank: 1 }])).toBeNull(); // bad name type
    expect(parseLeaderboardCurrent([{ display_name: "B", xp: "10", level: 2, rank: 1 }])).toBeNull(); // bad xp type
  });
});

describe("parseRecordSession", () => {
  it("parses success (ignoring any echoed session_id)", () => {
    expect(parseRecordSession({ ok: true })).toEqual({ ok: true });
    expect(parseRecordSession({ ok: true, session_id: "s1" })).toEqual({ ok: true });
  });
  it("parses the known failure reasons", () => {
    expect(parseRecordSession({ ok: false, reason: "invalid" })).toEqual({ ok: false, reason: "invalid" });
    expect(parseRecordSession({ ok: false, reason: "too_large" })).toEqual({ ok: false, reason: "too_large" });
    expect(parseRecordSession({ ok: false, reason: "unauthenticated" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });
  it("rejects malformed / unknown shapes", () => {
    expect(parseRecordSession({ ok: false, reason: "nope" })).toBeNull();
    expect(parseRecordSession({ ok: false })).toBeNull();
    expect(parseRecordSession({})).toBeNull();
    expect(parseRecordSession(null)).toBeNull();
  });
});
