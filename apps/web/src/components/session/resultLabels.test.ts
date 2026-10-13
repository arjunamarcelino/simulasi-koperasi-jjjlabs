import { describe, it, expect } from "vitest";
import { scoreTone, resolveScoreLabel, resolveStateChip, ENDING_STYLE } from "./resultLabels";

describe("scoreTone — threshold triad", () => {
  // >=70 good, >=40 warn, else bad (resultLabels.ts)
  it.each([
    [100, "good"],
    [70, "good"], // lower bound of good
    [69, "warn"],
    [40, "warn"], // lower bound of warn
    [39, "bad"],
    [0, "bad"],
    [-5, "bad"], // defensive negative
  ] as const)("scoreTone(%i) === %s", (score, tone) => {
    expect(scoreTone(score)).toBe(tone);
  });

  it("NaN falls through to bad (documents the else branch)", () => {
    expect(scoreTone(Number.NaN)).toBe("bad");
  });
});

describe("resolveScoreLabel — mapped vs prettify fallback", () => {
  it("maps a known score key", () => {
    expect(resolveScoreLabel("member_centric")).toBe("Member-Centric");
  });

  it("prettifies an unknown key (underscores → spaces)", () => {
    expect(resolveScoreLabel("unknown_key_x")).toBe("unknown key x");
  });
});

describe("resolveStateChip — the degrade-to-raw-string contract", () => {
  it("known key + known value → mapped label, mapped tone, known:true", () => {
    expect(resolveStateChip("State_Jalur_Remedi", "DIBERSIHKAN")).toEqual({
      keyLabel: "Jalur Remedi",
      valueLabel: "Data Dibersihkan",
      tone: "good",
      known: true,
    });
  });

  it("known key + UNKNOWN value → raw value, tone neutral, known:false", () => {
    expect(resolveStateChip("State_Jalur_Remedi", "WAT_IS_THIS")).toEqual({
      keyLabel: "Jalur Remedi",
      valueLabel: "WAT_IS_THIS", // degrades to the raw string, not a blank
      tone: "neutral",
      known: false,
    });
  });

  it("unknown key → prettifyKey fallback (strips State_ prefix), value still resolves", () => {
    const chip = resolveStateChip("State_Brand_New_Enum", "BENAR");
    expect(chip.keyLabel).toBe("Brand New Enum");
    expect(chip.valueLabel).toBe("Benar");
    expect(chip.tone).toBe("good");
    expect(chip.known).toBe(true);
  });
});

describe("ENDING_STYLE — every EndingType is styled", () => {
  it.each(["good", "neutral", "bad"] as const)("has a token set for %s", (kind) => {
    expect(ENDING_STYLE[kind]).toMatchObject({
      badgeLabel: expect.any(String),
      accent: expect.any(String),
      titleColor: expect.any(String),
      chip: expect.any(String),
    });
  });
});
