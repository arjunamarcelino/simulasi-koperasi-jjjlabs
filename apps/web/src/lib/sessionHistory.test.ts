import { describe, expect, it } from "vitest";
import {
  goodEndingScenarioIds,
  groupByScenario,
  rankBestResult,
  toSessionEnded,
} from "./sessionHistory";
import type { SessionRecord } from "./sessionsRepo.contracts";

const rec = (o: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  scenarioId: "kredit-macet",
  startedAt: 1000,
  endingType: "neutral",
  trigger: "manual",
  scores: {},
  stateClassification: {},
  narrativeFeedback: "",
  ...o,
});

describe("rankBestResult", () => {
  it("prefers a better ending even with a lower score", () => {
    const good = rec({ id: "a", endingType: "good", scores: { x: 10 } });
    const bad = rec({ id: "b", endingType: "bad", scores: { x: 99 } });
    expect(rankBestResult([bad, good]).id).toBe("a");
  });

  it("breaks an ending tie by higher total score", () => {
    const lo = rec({ id: "a", endingType: "good", scores: { x: 40, y: 10 } });
    const hi = rec({ id: "b", endingType: "good", scores: { x: 40, y: 40 } });
    expect(rankBestResult([lo, hi]).id).toBe("b");
  });

  it("breaks an ending+score tie by most recent", () => {
    const older = rec({ id: "a", endingType: "good", scores: { x: 50 }, startedAt: 1 });
    const newer = rec({ id: "b", endingType: "good", scores: { x: 50 }, startedAt: 2 });
    expect(rankBestResult([older, newer]).id).toBe("b");
  });

  it("breaks a full tie deterministically by lowest id", () => {
    const a = rec({ id: "a", startedAt: 5 });
    const b = rec({ id: "b", startedAt: 5 });
    expect(rankBestResult([b, a]).id).toBe("a");
  });

  it("handles tutorial rows (all scores empty → sum 0) without crashing", () => {
    const t1 = rec({ id: "a", scores: {}, startedAt: 1 });
    const t2 = rec({ id: "b", scores: {}, startedAt: 2 });
    expect(rankBestResult([t1, t2]).id).toBe("b"); // recency
  });

  it("returns the sole attempt", () => {
    expect(rankBestResult([rec({ id: "only" })]).id).toBe("only");
  });
});

describe("groupByScenario", () => {
  it("buckets by scenario with attempts newest-first", () => {
    const groups = groupByScenario([
      rec({ id: "old", scenarioId: "kredit-macet", startedAt: 1 }),
      rec({ id: "new", scenarioId: "kredit-macet", startedAt: 9 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.attempts.map((a) => a.id)).toEqual(["new", "old"]);
    expect(groups[0]?.title).toBe("Kredit Macet");
  });

  it("orders groups by catalog order", () => {
    const groups = groupByScenario([
      rec({ id: "t", scenarioId: "tutorial-koperasi-konsumen" }),
      rec({ id: "k", scenarioId: "kredit-macet" }),
      rec({ id: "r", scenarioId: "rapat-anggota-tahunan" }),
    ]);
    expect(groups.map((g) => g.scenarioId)).toEqual([
      "rapat-anggota-tahunan",
      "kredit-macet",
      "tutorial-koperasi-konsumen",
    ]);
  });

  it("falls back to the raw id for an unknown scenario and sorts it last", () => {
    const groups = groupByScenario([
      rec({ id: "u", scenarioId: "legacy-scenario-x" }),
      rec({ id: "k", scenarioId: "kredit-macet" }),
    ]);
    expect(groups.map((g) => g.scenarioId)).toEqual(["kredit-macet", "legacy-scenario-x"]);
    expect(groups[1]?.title).toBe("legacy-scenario-x");
  });

  it("returns [] for no records", () => {
    expect(groupByScenario([])).toEqual([]);
  });
});

describe("goodEndingScenarioIds", () => {
  it("returns a scenario whose only attempt ended good", () => {
    expect(goodEndingScenarioIds([rec({ scenarioId: "kredit-macet", endingType: "good" })])).toEqual([
      "kredit-macet",
    ]);
  });

  it("includes a scenario with any good attempt (best-attempt invariant)", () => {
    const ids = goodEndingScenarioIds([
      rec({ id: "a", scenarioId: "kredit-macet", endingType: "bad", startedAt: 1 }),
      rec({ id: "b", scenarioId: "kredit-macet", endingType: "good", startedAt: 2 }),
      rec({ id: "c", scenarioId: "kredit-macet", endingType: "bad", startedAt: 3 }),
    ]);
    expect(ids).toEqual(["kredit-macet"]);
  });

  it("includes a tutorial good ending despite empty scores", () => {
    expect(
      goodEndingScenarioIds([
        rec({ scenarioId: "tutorial-koperasi-konsumen", endingType: "good", scores: {} }),
      ]),
    ).toEqual(["tutorial-koperasi-konsumen"]);
  });

  it("excludes scenarios with only neutral/bad attempts", () => {
    expect(
      goodEndingScenarioIds([
        rec({ scenarioId: "kredit-macet", endingType: "neutral" }),
        rec({ scenarioId: "rapat-anggota-tahunan", endingType: "bad" }),
      ]),
    ).toEqual([]);
  });

  it("returns [] for no records", () => {
    expect(goodEndingScenarioIds([])).toEqual([]);
  });

  it("returns an uncatalogued raw id if its attempt ended good", () => {
    expect(
      goodEndingScenarioIds([rec({ scenarioId: "legacy-scenario-x", endingType: "good" })]),
    ).toEqual(["legacy-scenario-x"]);
  });
});

describe("toSessionEnded", () => {
  it("reassembles a full record with both trigger fields consistent", () => {
    const r = rec({
      scenarioId: "kredit-macet",
      endingType: "good",
      trigger: "sinyal_level_1",
      scores: { x: 80 },
      stateClassification: { k: "BENAR" },
      narrativeFeedback: "ok",
    });
    expect(toSessionEnded(r)).toEqual({
      trigger: "sinyal_level_1",
      result: {
        scenarioId: "kredit-macet",
        trigger: "sinyal_level_1",
        stateClassification: { k: "BENAR" },
        scores: { x: 80 },
        endingType: "good",
        narrativeFeedback: "ok",
      },
    });
  });

  it("reassembles a tutorial record (empty maps) without throwing", () => {
    const ended = toSessionEnded(rec({ scores: {}, stateClassification: {} }));
    expect(ended.result.scores).toEqual({});
    expect(ended.result.stateClassification).toEqual({});
  });
});
