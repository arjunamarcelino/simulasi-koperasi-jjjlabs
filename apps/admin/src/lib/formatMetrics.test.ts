import { describe, expect, it } from "vitest";
import { count, pct, score } from "./formatMetrics";

describe("formatMetrics (id-ID)", () => {
  it("count groups thousands with '.'", () => {
    expect(count(1234567)).toBe("1.234.567");
    expect(count(0)).toBe("0");
  });

  it("pct rounds to a whole percent, '—' for null", () => {
    expect(pct(0.8667)).toBe("87%");
    expect(pct(0.9)).toBe("90%");
    expect(pct(0)).toBe("0%");
    expect(pct(null)).toBe("—");
  });

  it("score uses a comma decimal (not a dot), '—' for null", () => {
    expect(score(71.4)).toBe("71,4");
    expect(score(55)).toBe("55,0");
    expect(score(null)).toBe("—");
  });
});
