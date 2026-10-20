import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenario.config";
import { evidenceStepIndex } from "../components/session/evidenceGuide";

// Scenarios 2 & 3 only make sense once the player has read the case file, so they opt
// into the open-the-file guide and lead their briefing with it. Others stay untouched.

const byId = (id: string) => {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) throw new Error(`missing scenario ${id}`);
  return sc;
};

describe.each(["kredit-macet", "keanggotaan-fiktif"])("%s — open-the-file guide", (id) => {
  const sc = byId(id);

  it("declares a complete guide", () => {
    const guide = sc.evidence?.guide;
    expect(guide?.callout).toBeTruthy();
    expect(guide?.nudge).toBeTruthy();
    expect(guide?.lookFor.length).toBeGreaterThan(0);
  });

  it("names the evidence button in its nudge", () => {
    expect(sc.evidence?.guide?.nudge).toContain(`'${sc.evidence?.title}'`);
  });

  it("leads the briefing with opening the file", () => {
    expect(evidenceStepIndex(sc.steps, sc.evidence?.title ?? "")).toBe(0);
  });
});

describe.each(["rapat-anggota-tahunan", "tutorial-koperasi-konsumen"])(
  "%s — no open-the-file guide (opt-in)",
  (id) => {
    it("declares no guide", () => {
      expect(byId(id).evidence?.guide).toBeUndefined();
    });
  },
);
