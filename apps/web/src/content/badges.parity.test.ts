import { describe, expect, it } from "vitest";
import { BADGES } from "./badges";
import { SCENARIOS } from "@simkop/catalog";

// BADGES is loaded from JSON via a double cast, so scenarioId literals are NOT
// type-checked. This guards the three-way id consistency (badges.json ↔ catalog
// scenarios ↔ emitted sessions.scenario_id) at the catalog→FE boundary: a typo like
// "rapat-anggota" or "kredit-macet " would otherwise earn nothing, silently.
describe("badge catalog parity", () => {
  const knownScenarioIds = new Set(SCENARIOS.map((s) => s.id));

  it("every scenarioGoodEnding criterion points at a real scenario", () => {
    for (const badge of BADGES) {
      if (badge.criteria?.kind === "scenarioGoodEnding") {
        expect(knownScenarioIds.has(badge.criteria.scenarioId)).toBe(true);
      }
    }
  });

  it("the three session teasers are wired (no permanently-locked null teaser remains)", () => {
    const wired = new Set(
      BADGES.filter((b) => b.criteria?.kind === "scenarioGoodEnding").map((b) => b.id),
    );
    expect(wired.has("juara-rat")).toBe(true);
    expect(wired.has("simpanan-rutin")).toBe(true);
    expect(wired.has("pinjaman-lancar")).toBe(true);
  });

  // contentId is not type-checked (JSON double cast), and an empty/typo id would make the
  // badge permanently unearnable — the read signal (markKnowledgeRead) emits a fixed id.
  it("every contentRead criterion carries a non-empty contentId", () => {
    for (const badge of BADGES) {
      if (badge.criteria?.kind === "contentRead") {
        expect(typeof badge.criteria.contentId).toBe("string");
        expect(badge.criteria.contentId.length).toBeGreaterThan(0);
      }
    }
  });

  it("the micro-learning reading badge is wired (contentRead, not a null teaser)", () => {
    const wired = BADGES.filter((b) => b.criteria?.kind === "contentRead").map((b) => b.id);
    expect(wired).toContain("pembaca-mading");
  });
});
