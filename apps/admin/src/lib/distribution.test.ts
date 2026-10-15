import { describe, expect, it } from "vitest";
import { BUCKET_LABELS, barHeightsPx, bucketsAriaLabel } from "./distribution";

describe("barHeightsPx", () => {
  it("scales proportionally to the tallest bucket", () => {
    // max = 10 → [2,5,10,0,0] of 100px → [20,50,100,0,0]
    expect(barHeightsPx([2, 5, 10, 0, 0], 100)).toEqual([20, 50, 100, 0, 0]);
  });

  it("all-zero buckets → all-zero heights (no NaN)", () => {
    const h = barHeightsPx([0, 0, 0, 0, 0], 96);
    expect(h).toEqual([0, 0, 0, 0, 0]);
    expect(h.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("a single non-zero bucket is full height", () => {
    expect(barHeightsPx([0, 0, 7, 0, 0], 96)).toEqual([0, 0, 96, 0, 0]);
  });
});

describe("bucketsAriaLabel", () => {
  it("enumerates all five bands with counts", () => {
    const label = bucketsAriaLabel("compliance", [3, 9, 12, 10, 6]);
    expect(label).toContain("compliance");
    for (const band of BUCKET_LABELS) expect(label).toContain(band);
    expect(label).toContain("81–100: 6 sesi");
  });

  it("treats a missing bucket as 0", () => {
    expect(bucketsAriaLabel("a", [1, 2])).toContain("41–60: 0 sesi");
  });
});
