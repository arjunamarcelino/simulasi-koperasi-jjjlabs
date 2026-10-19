import { describe, it, expect } from "vitest";
import {
  describeValueTrend,
  ENDING_STYLE,
  resolveScoreLabel,
  resolveStateChip,
  resolveValueLabel,
  scoreTone,
  valueTone,
} from "./resultLabels";
import type { ValueAssessment } from "../../session/transport/contract";

describe("scoreTone — threshold triad", () => {
  // >=70 good, >=40 warn, else bad (resultLabels.ts)
  // Only the branch boundaries carry signal; higher/lower values in a band are
  // redundant, so we pin 70/69 and 40/39 plus one representative bad case.
  it.each([
    [70, "good"], // lower bound of good
    [69, "warn"],
    [40, "warn"], // lower bound of warn
    [39, "bad"],
    [0, "bad"],
  ] as const)("scoreTone(%i) === %s", (score, tone) => {
    expect(scoreTone(score)).toBe(tone);
  });

  it("NaN falls through to bad (both comparisons are false — a non-obvious edge)", () => {
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

  it("resolves a bad-tone value", () => {
    expect(resolveStateChip("State_Relasi_NPC", "RUSAK")).toEqual({
      keyLabel: "Relasi Pengurus",
      valueLabel: "Relasi Rusak",
      tone: "bad",
      known: true,
    });
  });

  it("resolves a warn-tone value", () => {
    const chip = resolveStateChip("State_Analisis_Masalah", "NAIF");
    expect(chip.valueLabel).toBe("Terlalu Naif");
    expect(chip.tone).toBe("warn");
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

describe("ENDING_STYLE — every ending has a complete, correctly-labeled token set", () => {
  // Derive from the object itself (not a hardcoded list) and use toEqual so an
  // accidental extra/missing field is caught, not silently tolerated.
  it.each(Object.entries(ENDING_STYLE))("%s has exactly the four string tokens", (_kind, style) => {
    expect(style).toEqual({
      badgeLabel: expect.any(String),
      accent: expect.any(String),
      titleColor: expect.any(String),
      chip: expect.any(String),
    });
  });

  // Pin the user-facing badge text — a type cannot enforce the actual label.
  it("maps each ending to its human badge label", () => {
    expect(ENDING_STYLE.good.badgeLabel).toBe("Berhasil");
    expect(ENDING_STYLE.neutral.badgeLabel).toBe("Selesai");
    expect(ENDING_STYLE.bad.badgeLabel).toBe("Berakhir");
  });
});

const value = (o: Partial<ValueAssessment> = {}): ValueAssessment => ({
  status: "TERCERMIN",
  evidence: "",
  trend: "MENGUAT",
  ...o,
});

describe("resolveValueLabel — ICA value keys", () => {
  it("maps a known value key", () => {
    expect(resolveValueLabel("kepedulian")).toBe("Kepedulian terhadap Sesama");
  });

  it("prettifies an unknown key", () => {
    expect(resolveValueLabel("nilai_baru")).toBe("nilai baru");
  });
});

describe("describeValueTrend — words, not numbers", () => {
  it.each([
    ["MENGUAT", "▲ menguat"],
    ["MELEMAH", "▼ melemah"],
  ] as const)("%s reads as a direction only", (trend, text) => {
    expect(describeValueTrend(value({ trend }))).toBe(text);
  });

  it("a first assessment also says how the value showed up", () => {
    expect(describeValueTrend(value({ trend: "BARU_DIUJI", status: "DIABAIKAN" }))).toBe(
      "○ baru diuji · diabaikan",
    );
  });

  it("an unchanged value says at which level it held", () => {
    expect(describeValueTrend(value({ trend: "TETAP", status: "BELUM_TAMPAK" }))).toBe(
      "● tetap · belum tampak",
    );
  });
});

describe("valueTone", () => {
  it("follows the direction when the value moved", () => {
    expect(valueTone(value({ trend: "MENGUAT", status: "BELUM_TAMPAK" }))).toBe("good");
    expect(valueTone(value({ trend: "MELEMAH", status: "BELUM_TAMPAK" }))).toBe("bad");
  });

  it.each([
    ["TERCERMIN", "good"],
    ["BELUM_TAMPAK", "warn"],
    ["DIABAIKAN", "bad"],
  ] as const)("follows the status when it did not move (%s → %s)", (status, tone) => {
    expect(valueTone(value({ trend: "TETAP", status }))).toBe(tone);
    expect(valueTone(value({ trend: "BARU_DIUJI", status }))).toBe(tone);
  });
});
