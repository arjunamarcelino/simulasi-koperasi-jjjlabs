// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScenarioTable } from "./ScenarioTable";
import type { ScenarioRow } from "../../lib/adminApi";

afterEach(cleanup);

const ROWS: ScenarioRow[] = [
  {
    scenario_id: "kredit-macet",
    title: "Kredit Macet",
    sessions: 10,
    completion_rate: 0.9,
    ending_split: { good: 0.6, neutral: 0.2, bad: 0.2 },
    avg_score: 73,
  },
  {
    scenario_id: "keanggotaan-fiktif",
    title: "Keanggotaan Fiktif",
    sessions: 0,
    completion_rate: null,
    ending_split: null,
    avg_score: null,
  },
];

describe("ScenarioTable", () => {
  it("renders a disclosure BUTTON per row (not a role=button row — native table semantics kept)", () => {
    const { container } = render(
      <ScenarioTable rows={ROWS} openScenarioId={null} onRowClick={vi.fn()} />,
    );
    expect(container.querySelector('tr[role="button"]')).toBeNull();
    const btn = screen.getByRole("button", { name: "Kredit Macet" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking the title button calls onRowClick once with the id (stopPropagation, no double-toggle)", () => {
    const onRowClick = vi.fn();
    render(<ScenarioTable rows={ROWS} openScenarioId={null} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Kredit Macet" }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith("kredit-macet");
  });

  it("the open row's button is aria-expanded=true and names the controlled panel", () => {
    render(<ScenarioTable rows={ROWS} openScenarioId="kredit-macet" onRowClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Kredit Macet" });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe("scenario-panel-kredit-macet");
  });
});
