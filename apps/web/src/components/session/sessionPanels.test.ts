import { describe, expect, it } from "vitest";
import { INITIAL_PANELS, panelsReducer, type PanelState } from "./sessionPanels";

// The session's left slot holds the briefing (Deskripsi) OR the case file. Closing the
// file returns the player to whatever was open before it — typically the briefing they
// opened it from — instead of leaving the slot empty. Pure reducer, no DOM.

const run = (...actions: Parameters<typeof panelsReducer>[1][]): PanelState =>
  actions.reduce(panelsReducer, INITIAL_PANELS);

describe("panelsReducer", () => {
  it("starts on the briefing", () => {
    expect(INITIAL_PANELS.open).toBe("briefing");
  });

  it("closing the file opened from the briefing returns to the briefing", () => {
    expect(run("toggleEvidence", "closeEvidence").open).toBe("briefing");
  });

  it("toggling the file off (rail button) also returns to the briefing", () => {
    expect(run("toggleEvidence", "toggleEvidence").open).toBe("briefing");
  });

  it("closing the file opened with nothing on screen leaves the slot empty", () => {
    expect(run("closeBriefing", "toggleEvidence", "closeEvidence").open).toBeNull();
  });

  it("the return target is used once — a later close does not resurrect the briefing", () => {
    const state = run("toggleEvidence", "closeEvidence", "closeBriefing", "toggleEvidence");
    expect(panelsReducer(state, "closeEvidence").open).toBeNull();
  });

  it("switching from the file to the briefing shows the briefing", () => {
    expect(run("toggleEvidence", "toggleBriefing").open).toBe("briefing");
  });

  it("toggling the briefing closes and reopens it", () => {
    expect(run("toggleBriefing").open).toBeNull();
    expect(run("toggleBriefing", "toggleBriefing").open).toBe("briefing");
  });

  it("closing the file when it is not open changes nothing", () => {
    expect(run("closeEvidence")).toEqual(INITIAL_PANELS);
  });
});
