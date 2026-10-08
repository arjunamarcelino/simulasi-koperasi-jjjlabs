import { describe, expect, it } from "vitest";
import { count, pct, score } from "./formatMetrics";

describe("formatMetrics (id-ID)", () => {
  it("count groups thousands with '.'", () => {
    expect(count(1234567)).toBe("1.234.567");
    expect(count(0)).toBe("0");
  });

  it("pct rounds to a whole percent, '—' for null or out-of-[0,1]", () => {
    expect(pct(0.8667)).toBe("87%");
    expect(pct(0.9)).toBe("90%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
    expect(pct(null)).toBe("—");
    expect(pct(1.5)).toBe("—"); // backend returned a percent not a fraction → not "8700%"
    expect(pct(-0.1)).toBe("—");
  });

  it("score uses a comma decimal (not a dot), '—' for null or out-of-[0,100]", () => {
    expect(score(71.4)).toBe("71,4");
    expect(score(55)).toBe("55,0");
    expect(score(null)).toBe("—");
    expect(score(150)).toBe("—");
    expect(score(-5)).toBe("—");
  });
});
