import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSessionRow, parseSessionList } from "./sessionsRepo.contracts";

// The parsers are the type-soundness boundary: postgREST hands back an unvalidated row,
// so a malformed shape MUST narrow safely (skip the row) — never a bad object downstream.

const fullRow = {
  id: "s1",
  scenario_id: "kredit-macet",
  started_at: "2026-09-20T10:00:00.000Z",
  ended_at: "2026-09-20T10:12:00.000Z",
  trigger: "manual",
  ending_type: "good",
  scores_json: { member_centric: 80, compliance: 60 },
  state_json: { State_Jalur_Remedi: "BENAR" },
  narrative_feedback: "Bagus.",
};

describe("parseSessionRow", () => {
  it("parses a full finalized row, coercing started_at to epoch ms", () => {
    expect(parseSessionRow(fullRow)).toEqual({
      id: "s1",
      scenarioId: "kredit-macet",
      startedAt: Date.parse("2026-09-20T10:00:00.000Z"),
      endingType: "good",
      trigger: "manual",
      scores: { member_centric: 80, compliance: 60 },
      stateClassification: { State_Jalur_Remedi: "BENAR" },
      narrativeFeedback: "Bagus.",
    });
  });

  it("parses a tutorial row with empty maps", () => {
    const r = parseSessionRow({
      ...fullRow,
      ending_type: "neutral",
      scores_json: {},
      state_json: {},
    });
    expect(r?.scores).toEqual({});
    expect(r?.stateClassification).toEqual({});
  });

  it("coerces a null narrative to an empty string", () => {
    expect(parseSessionRow({ ...fullRow, narrative_feedback: null })?.narrativeFeedback).toBe("");
  });

  it("coerces a non-object scores/state blob to {} (keeps the row)", () => {
    const r = parseSessionRow({ ...fullRow, scores_json: "oops", state_json: [1, 2] });
    expect(r).not.toBeNull();
    expect(r?.scores).toEqual({});
    expect(r?.stateClassification).toEqual({});
  });

  it("drops non-finite / non-numeric score entries", () => {
    const r = parseSessionRow({
      ...fullRow,
      scores_json: { a: 90, b: "80", c: Number.NaN, d: Number.POSITIVE_INFINITY },
    });
    expect(r?.scores).toEqual({ a: 90 });
  });

  it("rejects out-of-enum ending_type / trigger", () => {
    expect(parseSessionRow({ ...fullRow, ending_type: "win" })).toBeNull();
    expect(parseSessionRow({ ...fullRow, trigger: "bogus" })).toBeNull();
  });

  it("rejects an unparseable started_at", () => {
    expect(parseSessionRow({ ...fullRow, started_at: "not-a-date" })).toBeNull();
    expect(parseSessionRow({ ...fullRow, started_at: 123 })).toBeNull();
  });

  it("rejects a missing id / scenario_id and non-object input", () => {
    expect(parseSessionRow({ ...fullRow, id: undefined })).toBeNull();
    expect(parseSessionRow({ ...fullRow, scenario_id: null })).toBeNull();
    expect(parseSessionRow(null)).toBeNull();
    expect(parseSessionRow("x")).toBeNull();
  });
});

describe("parseSessionList", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns an empty array for [] (→ ok/empty, not invalid)", () => {
    expect(parseSessionList([])).toEqual([]);
  });

  it("skips a malformed row and keeps the valid ones", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = parseSessionList([fullRow, { ...fullRow, ending_type: "win" }, { ...fullRow, id: "s2" }]);
    expect(list?.map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  it("returns null when the top-level shape is not an array (→ invalid)", () => {
    expect(parseSessionList({ nope: true })).toBeNull();
    expect(parseSessionList(null)).toBeNull();
  });
});
