import { describe, expect, it } from "vitest";
import { parseValueAssessments } from "./valueAssessment";

// One boundary parser for the ICA value assessments, shared by the live auditor payload
// (LiveKit) and persisted rows (`sessions.values_json`). The UI renders closed unions, so
// anything outside them is dropped here rather than cast through.

const item = { status: "TERCERMIN", evidence: "Bertanya dulu.", trend: "MENGUAT" };

describe("parseValueAssessments", () => {
  it("keeps well-formed entries as-is", () => {
    expect(parseValueAssessments({ kepedulian: item })).toEqual({ kepedulian: item });
  });

  it.each([null, undefined, "teks", 5, ["kepedulian"]])("non-object %p → {}", (raw) => {
    expect(parseValueAssessments(raw)).toEqual({});
  });

  it("drops an entry whose status is outside the closed set", () => {
    const out = parseValueAssessments({ kepedulian: { ...item, status: "HEBAT" }, keadilan: item });
    expect(out).toEqual({ keadilan: item });
  });

  it("drops an entry whose trend is outside the closed set", () => {
    const out = parseValueAssessments({ kepedulian: { ...item, trend: "NAIK" }, keadilan: item });
    expect(out).toEqual({ keadilan: item });
  });

  it("drops an entry that is not an object", () => {
    expect(parseValueAssessments({ kepedulian: "TERCERMIN", keadilan: item })).toEqual({
      keadilan: item,
    });
  });

  it("coerces a non-string evidence to an empty string (keeps the entry)", () => {
    expect(parseValueAssessments({ kepedulian: { ...item, evidence: 42 } })).toEqual({
      kepedulian: { ...item, evidence: "" },
    });
  });
});
