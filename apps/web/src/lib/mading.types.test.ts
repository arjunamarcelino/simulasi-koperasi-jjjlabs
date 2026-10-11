import { describe, expect, it } from "vitest";
import { parseNote, parseSlide, parseKnowledge, parseIdentitas } from "./mading.types";

// The client half of the mading payload contract (SIM-18). The same accept/reject cases are
// mirrored by the FastAPI Pydantic models and the DB `_mading_reject_reason` (asserted in their
// own suites). Parsers are CLOSED — a foreign key per variant is rejected.

describe("parseNote (info)", () => {
  it("accepts a well-formed note", () => {
    expect(parseNote({ title: "T", lines: ["a", "b"], accent: "mustard" })).toEqual({
      title: "T",
      lines: ["a", "b"],
      accent: "mustard",
    });
  });
  it.each([
    ["missing title", { lines: ["a"], accent: "mustard" }],
    ["empty title", { title: "  ", lines: ["a"], accent: "mustard" }],
    ["lines not array", { title: "T", lines: "a", accent: "mustard" }],
    ["empty lines", { title: "T", lines: [], accent: "mustard" }],
    ["bad accent", { title: "T", lines: ["a"], accent: "neon" }],
    ["foreign key", { title: "T", lines: ["a"], accent: "mustard", evil: 1 }],
  ])("rejects: %s", (_label, bad) => {
    expect(parseNote(bad)).toBeNull();
  });
});

describe("parseSlide (data)", () => {
  it("accepts headers+rows (+optional align/caption)", () => {
    expect(
      parseSlide({ title: "T", caption: "c", headers: ["H1", "H2"], align: ["left", "right"], rows: [["a", "b"]] }),
    ).toEqual({ title: "T", caption: "c", headers: ["H1", "H2"], align: ["left", "right"], rows: [["a", "b"]] });
  });
  it("accepts without optional align/caption", () => {
    expect(parseSlide({ title: "T", headers: ["H1"], rows: [["a"]] })).toEqual({
      title: "T",
      headers: ["H1"],
      rows: [["a"]],
    });
  });
  it.each([
    ["row length != headers", { title: "T", headers: ["H1", "H2"], rows: [["a"]] }],
    ["align length != headers", { title: "T", headers: ["H1", "H2"], align: ["left"], rows: [["a", "b"]] }],
    ["empty headers", { title: "T", headers: [], rows: [] }],
    ["bad align value", { title: "T", headers: ["H1"], align: ["center"], rows: [["a"]] }],
    ["missing title", { headers: ["H1"], rows: [["a"]] }],
    ["foreign key", { title: "T", headers: ["H1"], rows: [["a"]], evil: 1 }],
  ])("rejects: %s", (_label, bad) => {
    expect(parseSlide(bad)).toBeNull();
  });
});

describe("parseKnowledge", () => {
  it("accepts a stat and a fact", () => {
    expect(parseKnowledge({ kind: "stat", value: "1", label: "L", group: "G" })).toEqual({
      kind: "stat",
      value: "1",
      label: "L",
      group: "G",
    });
    expect(parseKnowledge({ kind: "fact", text: "hi", chip: "Prinsip Koperasi" })).toEqual({
      kind: "fact",
      text: "hi",
      chip: "Prinsip Koperasi",
    });
  });
  it.each([
    ["unknown kind", { kind: "quote", text: "x" }],
    ["stat missing value", { kind: "stat", label: "L" }],
    ["stat carrying text (foreign)", { kind: "stat", value: "1", label: "L", text: "x" }],
    ["fact missing text", { kind: "fact" }],
    ["fact carrying value (foreign)", { kind: "fact", text: "t", value: "1" }],
    ["fact bad chip", { kind: "fact", text: "t", chip: "Lainnya" }],
  ])("rejects: %s", (_label, bad) => {
    expect(parseKnowledge(bad)).toBeNull();
  });
});

describe("parseIdentitas", () => {
  it("accepts the four fields", () => {
    const ok = { nama: "N", badanHukum: "B", alamat: "A", desa: "D" };
    expect(parseIdentitas(ok)).toEqual(ok);
  });
  it.each([
    ["missing field", { nama: "N", badanHukum: "B", alamat: "A" }],
    ["foreign key", { nama: "N", badanHukum: "B", alamat: "A", desa: "D", evil: 1 }],
  ])("rejects: %s", (_label, bad) => {
    expect(parseIdentitas(bad)).toBeNull();
  });
});
