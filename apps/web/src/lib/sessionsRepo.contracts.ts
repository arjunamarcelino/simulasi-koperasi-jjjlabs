/**
 * Domain result contracts for the `sessions` read path. postgREST hands back an
 * unvalidated row shape for every jsonb column, so we narrow it here with hand-written
 * guards (mirroring the `progressRepo.contracts` idiom — no zod).
 *
 * Divergence from `parseQuizCatalog` (all-or-nothing) is deliberate: for a history LIST
 * one malformed row must not blank the whole tab, so `parseSessionList` SKIPS bad rows
 * and returns the valid ones. A row is skipped only on a bad id / unparseable timestamp /
 * out-of-enum ending_type|trigger; a malformed scores/state blob coerces to `{}` (the DB
 * default) because a finalized attempt with a junk blob is still a real attempt.
 */

// Derived from the transport contract so the persistence path can't silently drift from
// the live session vocabulary. The runtime guard tables below (Record<…, true>) then fail
// to compile if the contract adds a member — the drift guard is structural.
import type { EndingType, FinalDecisionTrigger } from "../session/transport/contract";
import { isRecord, str } from "./parseGuards";
export type { EndingType };
export type SessionTrigger = FinalDecisionTrigger;

/** One finalized attempt, narrowed from a raw `sessions` row. */
export type SessionRecord = {
  id: string;
  scenarioId: string; // raw DB code — may not be in the shipped @simkop/catalog
  startedAt: number; // epoch ms
  endingType: EndingType;
  trigger: SessionTrigger;
  scores: Record<string, number>; // numeric-finite entries only
  stateClassification: Record<string, string>; // string entries only
  narrativeFeedback: string; // null coerced to ""
};

// — narrowing helpers ————————————————————————————————————————————————
const ENDING_TYPES: Record<EndingType, true> = { good: true, bad: true, neutral: true };
const TRIGGERS: Record<SessionTrigger, true> = {
  manual: true,
  sinyal_level_1: true,
  force_quit_level_2: true,
};
const asEnding = (u: unknown): EndingType | null =>
  typeof u === "string" && Object.prototype.hasOwnProperty.call(ENDING_TYPES, u)
    ? (u as EndingType)
    : null;
const asTrigger = (u: unknown): SessionTrigger | null =>
  typeof u === "string" && Object.prototype.hasOwnProperty.call(TRIGGERS, u)
    ? (u as SessionTrigger)
    : null;

/** jsonb → numeric-only map. Non-object (array/string/null) → {}. Drops "80"/NaN/Infinity. */
const numericEntries = (u: unknown): Record<string, number> => {
  if (!isRecord(u)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(u)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
};

/** jsonb → string-only map. Non-object → {}. */
const stringEntries = (u: unknown): Record<string, string> => {
  if (!isRecord(u)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(u)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
};

/** Narrow one raw `sessions` row, or null if it isn't a renderable finalized attempt. */
export function parseSessionRow(u: unknown): SessionRecord | null {
  if (!isRecord(u)) return null;
  const id = str(u["id"]);
  const scenarioId = str(u["scenario_id"]);
  if (id === null || scenarioId === null) return null;

  const startedRaw = u["started_at"];
  const startedAt = typeof startedRaw === "string" ? Date.parse(startedRaw) : NaN;
  if (!Number.isFinite(startedAt)) return null;

  const endingType = asEnding(u["ending_type"]);
  const trigger = asTrigger(u["trigger"]);
  if (endingType === null || trigger === null) return null; // not finalized / bad enum

  const narrative = u["narrative_feedback"];
  // One complete literal — no conditional/spread props (exactOptionalPropertyTypes).
  return {
    id,
    scenarioId,
    startedAt,
    endingType,
    trigger,
    scores: numericEntries(u["scores_json"]),
    stateClassification: stringEntries(u["state_json"]),
    narrativeFeedback: narrative === null || narrative === undefined ? "" : (str(narrative) ?? ""),
  };
}

/** Narrow a list of raw rows, skipping (not failing on) individual bad rows. Returns
 *  null only when the top-level shape is not an array → surfaces as `invalid`. */
export function parseSessionList(u: unknown): SessionRecord[] | null {
  if (!Array.isArray(u)) return null;
  const out: SessionRecord[] = [];
  for (const row of u) {
    const parsed = parseSessionRow(row);
    if (parsed) out.push(parsed);
    else if (import.meta.env.DEV) console.warn("[sessionsRepo] skipped malformed session row", row);
  }
  return out;
}
