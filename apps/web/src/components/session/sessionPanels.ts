/**
 * The session's left slot: the briefing (Deskripsi) or the case file, never both.
 * Opening the file remembers what it replaced, so closing it goes back there (e.g.
 * the briefing the player opened it from) rather than leaving the slot empty.
 */

export type LeftPanel = "briefing" | "evidence" | null;

export type PanelState = {
  open: LeftPanel;
  /** What closing the case file returns to. */
  back: LeftPanel;
};

export type PanelAction = "toggleBriefing" | "closeBriefing" | "toggleEvidence" | "closeEvidence";

/** Briefing opens by default so the player sees the mission before talking. */
export const INITIAL_PANELS: PanelState = { open: "briefing", back: null };

export function panelsReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action) {
    case "toggleBriefing":
      return { open: state.open === "briefing" ? null : "briefing", back: null };
    case "closeBriefing":
      return { open: null, back: null };
    case "toggleEvidence":
      return state.open === "evidence"
        ? panelsReducer(state, "closeEvidence")
        : { open: "evidence", back: state.open };
    case "closeEvidence":
      return state.open === "evidence" ? { open: state.back, back: null } : state;
  }
}
