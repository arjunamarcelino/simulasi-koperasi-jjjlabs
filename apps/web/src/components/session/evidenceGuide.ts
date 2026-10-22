import type { TranscriptItem } from "../../session/transport/contract";

/**
 * Decision logic for the "open the case file" nudge (scenarios whose evidence
 * declares a `guide`). Pure, so SessionOverlay only wires state to it.
 */

/** Finished player turns without opening the file before the one-shot reminder. */
export const EVIDENCE_REMINDER_AFTER_TURNS = 2;

/** Player lines that are done (a streaming line is still being transcribed). */
export function completedPlayerTurns(transcript: readonly TranscriptItem[]): number {
  return transcript.filter((t) => t.speaker === "player" && !t.streaming).length;
}

/**
 * The reminder fires once per session, only while the file is still unopened, and
 * never over a hint the player is already reading.
 */
export function shouldRemindEvidence({
  hasGuide,
  opened,
  reminded,
  hintShowing,
  playerTurns,
}: {
  hasGuide: boolean;
  opened: boolean;
  reminded: boolean;
  hintShowing: boolean;
  playerTurns: number;
}): boolean {
  return (
    hasGuide &&
    !opened &&
    !reminded &&
    !hintShowing &&
    playerTurns >= EVIDENCE_REMINDER_AFTER_TURNS
  );
}

/**
 * Index of the briefing step that names the evidence button in quotes (e.g.
 * "Buka 'Periksa Bukti' …"), or -1. That step gets an inline open action.
 */
export function evidenceStepIndex(steps: readonly string[] | undefined, title: string): number {
  if (!steps) return -1;
  return steps.findIndex((step) => step.includes(`'${title}'`));
}
