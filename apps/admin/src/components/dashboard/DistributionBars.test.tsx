// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DistributionBars } from "./DistributionBars";

afterEach(cleanup);

describe("DistributionBars", () => {
  it("exposes one enumerated aria-label covering all 5 bands (the AT twin for N=5)", () => {
    render(<DistributionBars pillarKey="compliance" buckets={[3, 9, 12, 10, 6]} avg={58.2} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("compliance");
    expect(label).toContain("0–20: 3 sesi");
    expect(label).toContain("81–100: 6 sesi");
  });

  it("renders the pillar key as a heading and the avg via score()", () => {
    render(<DistributionBars pillarKey="compliance" buckets={[1, 0, 0, 0, 0]} avg={10} />);
    expect(screen.getByText("compliance")).toBeTruthy();
    expect(screen.getByText(/rata-rata/)).toBeTruthy();
  });

  it("all-zero buckets render without crashing and still show the band axis labels", () => {
    const { container } = render(
      <DistributionBars pillarKey="x" buckets={[0, 0, 0, 0, 0]} avg={null} />,
    );
    expect(screen.getByRole("img")).toBeTruthy();
    expect(container.textContent).toContain("0–20");
    expect(container.textContent).toContain("81–100");
    // no NaN leaked into inline heights
    expect(container.innerHTML).not.toContain("NaN");
  });
});
