import { describe, expect, it } from "vitest";
import { BADGES, isEarned, readContentIdsFromEarned, type BadgeContext } from "./badges";
import type { BadgeCriteria } from "@simkop/catalog";

const ctx = (o: Partial<BadgeContext> = {}): BadgeContext => ({
  xp: 0,
  level: 1,
  point: 0,
  completedMissionIds: [],
  voucherCount: 0,
  goodEndingScenarioIds: [],
  readContentIds: [],
  ...o,
});

describe("isEarned — scenarioGoodEnding", () => {
  const rat: BadgeCriteria = { kind: "scenarioGoodEnding", scenarioId: "rapat-anggota-tahunan" };

  it("earns when the scenario is in goodEndingScenarioIds", () => {
    expect(isEarned(rat, ctx({ goodEndingScenarioIds: ["rapat-anggota-tahunan"] }))).toBe(true);
  });

  it("earns when the target is among several good endings", () => {
    const ids = ["kredit-macet", "rapat-anggota-tahunan", "tutorial-koperasi-konsumen"];
    expect(isEarned(rat, ctx({ goodEndingScenarioIds: ids }))).toBe(true);
  });

  it("does not earn when the scenario is absent", () => {
    expect(isEarned(rat, ctx({ goodEndingScenarioIds: ["kredit-macet"] }))).toBe(false);
  });

  it("does not earn with an empty good-ending set", () => {
    expect(isEarned(rat, ctx())).toBe(false);
  });

  it("requires an exact id match (case / whitespace sensitive)", () => {
    expect(isEarned(rat, ctx({ goodEndingScenarioIds: ["Rapat-Anggota-Tahunan"] }))).toBe(false);
    expect(isEarned(rat, ctx({ goodEndingScenarioIds: [" rapat-anggota-tahunan"] }))).toBe(false);
  });
});

describe("isEarned — contentRead", () => {
  const knowledge: BadgeCriteria = { kind: "contentRead", contentId: "knowledge" };

  it("earns when the content id has been read", () => {
    expect(isEarned(knowledge, ctx({ readContentIds: ["knowledge"] }))).toBe(true);
  });

  it("does not earn when the content id is absent", () => {
    expect(isEarned(knowledge, ctx({ readContentIds: ["data"] }))).toBe(false);
  });

  it("does not earn with an empty read set", () => {
    expect(isEarned(knowledge, ctx())).toBe(false);
  });

  it("requires an exact content-id match", () => {
    expect(isEarned(knowledge, ctx({ readContentIds: ["Knowledge"] }))).toBe(false);
  });
});

describe("readContentIdsFromEarned", () => {
  // The catalog ships exactly one contentRead badge today (pembaca-mading / "knowledge").
  const readingBadge = BADGES.find((b) => b.criteria?.kind === "contentRead");

  it("maps an earned contentRead badge id to its contentId", () => {
    expect(readingBadge).toBeDefined();
    const contentId =
      readingBadge!.criteria?.kind === "contentRead" ? readingBadge!.criteria.contentId : "";
    expect(readContentIdsFromEarned([readingBadge!.id])).toEqual([contentId]);
  });

  it("ignores earned ids that are not contentRead badges", () => {
    expect(readContentIdsFromEarned(["anggota-aktif", "juara-rat"])).toEqual([]);
  });

  it("returns an empty list for no earned badges", () => {
    expect(readContentIdsFromEarned([])).toEqual([]);
  });
});

describe("isEarned — null teaser + existing kinds (no regression)", () => {
  it("a null criteria is never earned", () => {
    expect(isEarned(null, ctx({ goodEndingScenarioIds: ["rapat-anggota-tahunan"] }))).toBe(false);
  });

  it("level/point/voucherCount thresholds still evaluate", () => {
    expect(isEarned({ kind: "level", min: 3 }, ctx({ level: 3 }))).toBe(true);
    expect(isEarned({ kind: "level", min: 3 }, ctx({ level: 2 }))).toBe(false);
    expect(isEarned({ kind: "point", min: 100 }, ctx({ point: 100 }))).toBe(true);
    expect(isEarned({ kind: "voucherCount", min: 1 }, ctx({ voucherCount: 1 }))).toBe(true);
  });

  it("missionCount/missionDone still evaluate", () => {
    expect(isEarned({ kind: "missionCount", min: 2 }, ctx({ completedMissionIds: ["a", "b"] }))).toBe(true);
    expect(isEarned({ kind: "missionDone", missionId: "main-kuis" }, ctx({ completedMissionIds: ["main-kuis"] }))).toBe(true);
    expect(isEarned({ kind: "missionDone", missionId: "main-kuis" }, ctx())).toBe(false);
  });
});
