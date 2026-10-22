import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../session/transport/contract";
import {
  EVIDENCE_REMINDER_AFTER_TURNS,
  completedPlayerTurns,
  evidenceStepIndex,
  shouldRemindEvidence,
} from "./evidenceGuide";

// The "open the case file" nudge is pure decision logic — kept out of SessionOverlay so
// it can be pinned here without a DOM.

const item = (speaker: TranscriptItem["speaker"], streaming = false): TranscriptItem => ({
  id: `${speaker}-${Math.random()}`,
  speaker,
  text: "…",
  streaming,
  at: 0,
});

describe("completedPlayerTurns", () => {
  it("counts only finished player lines", () => {
    const transcript = [
      item("npc"),
      item("player"),
      item("system"),
      item("npc"),
      item("player"),
      item("player", true), // still being transcribed — not a turn yet
    ];
    expect(completedPlayerTurns(transcript)).toBe(2);
  });

  it("is zero for an empty transcript", () => {
    expect(completedPlayerTurns([])).toBe(0);
  });
});

describe("shouldRemindEvidence", () => {
  const due = {
    hasGuide: true,
    opened: false,
    reminded: false,
    hintShowing: false,
    playerTurns: EVIDENCE_REMINDER_AFTER_TURNS,
  };

  it("reminds once the player has talked a while without opening the file", () => {
    expect(shouldRemindEvidence(due)).toBe(true);
  });

  it("waits until enough player turns have passed", () => {
    expect(shouldRemindEvidence({ ...due, playerTurns: EVIDENCE_REMINDER_AFTER_TURNS - 1 })).toBe(
      false,
    );
  });

  it("never fires for a scenario without a guide", () => {
    expect(shouldRemindEvidence({ ...due, hasGuide: false })).toBe(false);
  });

  it("stops once the file was opened", () => {
    expect(shouldRemindEvidence({ ...due, opened: true })).toBe(false);
  });

  it("fires at most once per session", () => {
    expect(shouldRemindEvidence({ ...due, reminded: true })).toBe(false);
  });

  it("never overwrites a hint that is already on screen", () => {
    expect(shouldRemindEvidence({ ...due, hintShowing: true })).toBe(false);
  });
});

describe("evidenceStepIndex", () => {
  const steps = ["Sapa dengan tenang.", "Buka 'Periksa Bukti' untuk melihat riwayat.", "Akhiri."];

  it("finds the step that names the evidence button", () => {
    expect(evidenceStepIndex(steps, "Periksa Bukti")).toBe(1);
  });

  it("matches the quoted title only, not a loose mention", () => {
    expect(evidenceStepIndex(["Periksa Bukti nanti saja."], "Periksa Bukti")).toBe(-1);
  });

  it("is -1 when no step names it or there are no steps", () => {
    expect(evidenceStepIndex(steps, "Periksa Dokumen")).toBe(-1);
    expect(evidenceStepIndex(undefined, "Periksa Bukti")).toBe(-1);
  });
});
