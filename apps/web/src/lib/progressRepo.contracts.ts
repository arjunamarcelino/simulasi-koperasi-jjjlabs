/**
 * Domain result contracts for the progress RPCs. postgREST hands back an unvalidated
 * `Json` for every jsonb-returning function, so we narrow it here with hand-written
 * guards (mirroring the `isRedeemedVoucher` idiom — no zod for four RPCs). Variants
 * are modelled as separate union members (never optional `?:` fields) so they stay
 * sound under `exactOptionalPropertyTypes`.
 */
import { isRedeemedVoucher, type RedeemedVoucher } from "../content/vouchers";

export type Totals = { xp: number; point: number };

/** A single answer the client submits to submit_quiz. */
export type QuizAnswer = { code: string; choice: number };

export type ClaimMissionResult =
  | { ok: true; reward: Totals; totals: Totals }
  | { ok: false; reason: "unknown" | "wrong-code" | "already" };

export type RedeemVoucherResult =
  | { ok: true; code: string; balance: number }
  | { ok: false; reason: "unknown" | "no_progress" | "insufficient" };

export type QuizResultRow = {
  code: string;
  correct: boolean;
  explanation: string | null;
  alreadyCredited: boolean;
};
export type SubmitQuizResult =
  | { ok: true; awarded: Totals; totals: Totals; results: QuizResultRow[] }
  | { ok: false; reason: "invalid" | "too_many" | "unknown_question" };

export type ReconcileResult =
  | { ok: true; applied: true; totals: Totals }
  | { ok: true; applied: false } // server already reconciled this account
  | { ok: false; reason: "uid_mismatch" };

/** The full wallet snapshot returned by get_my_progress. */
export type MyProgress = {
  xp: number;
  point: number;
  missions: string[];
  vouchers: RedeemedVoucher[];
  badges: string[];
};

// — narrowing helpers ————————————————————————————————————————————————
const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);
const num = (u: unknown): number | null =>
  typeof u === "number" && Number.isFinite(u) ? u : null;
const str = (u: unknown): string | null => (typeof u === "string" ? u : null);
const strArray = (u: unknown): string[] | null =>
  Array.isArray(u) && u.every((x) => typeof x === "string") ? (u as string[]) : null;

function parseTotals(u: unknown): Totals | null {
  if (!isRecord(u)) return null;
  const xp = num(u["xp"]);
  const point = num(u["point"]);
  return xp !== null && point !== null ? { xp, point } : null;
}

export function parseClaimMission(u: unknown): ClaimMissionResult | null {
  if (!isRecord(u)) return null;
  if (u["ok"] === false) {
    const reason = str(u["reason"]);
    return reason === "unknown" || reason === "wrong-code" || reason === "already"
      ? { ok: false, reason }
      : null;
  }
  if (u["ok"] !== true) return null;
  const reward = parseTotals(u["reward"]);
  const totals = parseTotals(u["totals"]);
  return reward && totals ? { ok: true, reward, totals } : null;
}

export function parseRedeemVoucher(u: unknown): RedeemVoucherResult | null {
  if (!isRecord(u)) return null;
  if (u["ok"] === false) {
    const reason = str(u["reason"]);
    return reason === "unknown" || reason === "no_progress" || reason === "insufficient"
      ? { ok: false, reason }
      : null;
  }
  if (u["ok"] !== true) return null;
  const code = str(u["code"]);
  const balance = num(u["balance"]);
  return code !== null && balance !== null ? { ok: true, code, balance } : null;
}

function parseQuizRow(u: unknown): QuizResultRow | null {
  if (!isRecord(u)) return null;
  const code = str(u["code"]);
  if (code === null || typeof u["correct"] !== "boolean") return null;
  const explanation = u["explanation"] === null ? null : str(u["explanation"]);
  if (explanation === null && u["explanation"] !== null) return null;
  return {
    code,
    correct: u["correct"],
    explanation,
    alreadyCredited: u["already_credited"] === true,
  };
}

export function parseSubmitQuiz(u: unknown): SubmitQuizResult | null {
  if (!isRecord(u)) return null;
  if (u["ok"] === false) {
    const reason = str(u["reason"]);
    return reason === "invalid" || reason === "too_many" || reason === "unknown_question"
      ? { ok: false, reason }
      : null;
  }
  if (u["ok"] !== true) return null;
  const awarded = parseTotals(u["awarded"]);
  const totals = parseTotals(u["totals"]);
  const rows = u["results"];
  if (!awarded || !totals || !Array.isArray(rows)) return null;
  const results: QuizResultRow[] = [];
  for (const r of rows) {
    const row = parseQuizRow(r);
    if (!row) return null;
    results.push(row);
  }
  return { ok: true, awarded, totals, results };
}

export function parseReconcile(u: unknown): ReconcileResult | null {
  if (!isRecord(u)) return null;
  if (u["ok"] === false) {
    return str(u["reason"]) === "uid_mismatch" ? { ok: false, reason: "uid_mismatch" } : null;
  }
  if (u["ok"] !== true) return null;
  if (u["skipped"] === "already") return { ok: true, applied: false };
  const totals = parseTotals(u["totals"]);
  return totals ? { ok: true, applied: true, totals } : null;
}

export function parseMyProgress(u: unknown): MyProgress | null {
  if (!isRecord(u)) return null;
  const progress = u["progress"];
  // A brand-new account (or an anon caller) can legitimately have no progress row.
  let xp = 0;
  let point = 0;
  if (isRecord(progress)) {
    const px = num(progress["xp"]);
    const pp = num(progress["point"]);
    if (px === null || pp === null) return null;
    xp = px;
    point = pp;
  } else if (progress !== null && progress !== undefined) {
    return null;
  }
  const missions = strArray(u["missions"]);
  const badges = strArray(u["badges"]);
  const rawVouchers = u["vouchers"];
  if (missions === null || badges === null || !Array.isArray(rawVouchers)) return null;
  const vouchers: RedeemedVoucher[] = [];
  for (const v of rawVouchers) {
    if (!isRedeemedVoucher(v)) return null;
    vouchers.push(v);
  }
  return { xp, point, missions, vouchers, badges };
}
