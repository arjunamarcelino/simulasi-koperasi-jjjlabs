import { supabase } from "./supabase";
import { ENV } from "../config/env";

/**
 * Total outcome of probing `GET /admin/me`. The store is a pure reducer over this —
 * it never sees a raw Response and never branches on the body's `is_admin` (which is
 * always true in a 200, so it carries no authorization info). Authorization lives in
 * the HTTP STATUS only.
 */
export type ProbeOutcome =
  | { kind: "authorized"; userId: string }
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 (after a single refresh-retry) or no session
  | { kind: "serviceUnavailable" } // 503/500/network/timeout/malformed-200 — all "try again"
  | { kind: "authUnavailable" }; // null client (missing env)

/** GET /admin/metrics outcome (SIM-15). Mirrors ProbeOutcome's non-200 kinds + an `ok`
 * carrying the validated dashboard payload. Gated on STATUS; the 200 body is accepted
 * only when it passes the DEEP shape guard (a malformed 200 is a fault, not data). */
export type MetricsOutcome =
  | { kind: "ok"; data: AdminMetrics }
  | { kind: "notAuthorized" } // 403 (admin revoked mid-session)
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "serviceUnavailable" }; // 503/500/404/network/timeout/malformed-200/null-client

export type EndingSplit = { good: number; neutral: number; bad: number };
export type ScenarioRow = {
  scenario_id: string;
  title: string;
  sessions: number;
  completion_rate: number | null;
  ending_split: EndingSplit | null;
  avg_score: number | null;
};
export type AdminMetrics = {
  generated_at: string;
  users: { active_30d: number; total_registered: number; new_7d: number };
  sessions: {
    total: number;
    completion_rate: number | null;
    ending_split: EndingSplit | null;
    avg_score: number | null;
  };
  per_scenario: ScenarioRow[];
};

/** GET /admin/scenarios/{id}/analytics outcome (SIM-16). Like MetricsOutcome but adds a
 * distinct `notFound` (404 unknown scenario — terminal, no retry button). Gated on STATUS;
 * the 200 body must pass the DEEP shape guard or it's a fault. */
export type ScenarioAnalyticsOutcome =
  | { kind: "ok"; data: ScenarioAnalytics }
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "notFound" } // 404 — unknown scenario; retrying is pointless
  | { kind: "serviceUnavailable" }; // 503/500/network/timeout/malformed-200/null-client

// buckets is always exactly 5 bands (0–20 … 81–100) — a 5-tuple carries the invariant the guard
// enforces at runtime (length === 5) into the type system.
export type PillarDist = {
  key: string;
  count: number;
  avg: number | null;
  buckets: readonly [number, number, number, number, number];
};
export type OutcomeBreakdown = {
  completed: number;
  bubar: number;
  by_trigger: Record<string, number>; // open map — a new trigger value must not break the type
  ending_counts: { good: number; neutral: number; bad: number };
};
export type ScenarioAnalytics = {
  scenario_id: string;
  title: string;
  generated_at: string;
  attempts: number;
  outcome: OutcomeBreakdown;
  avg_score: number | null;
  pillars: PillarDist[];
  // Always null in Core; the event-log follow-up ticket introduces the drop-off shape then.
  dropoff: null;
};

// --- SIM-17 seasonal leaderboard --------------------------------------------
// THREE separate outcome unions (not one): the overview read and the capture write share the
// non-200 shape (no notFound — those paths have no "unknown resource" status), while DELETE adds a
// DISTINCT `notFound` (404) that the store treats as success (the season is already gone).

/** One row of the seasons list AND the header fields of the selected season. */
export type SeasonHeader = {
  id: string;
  season_number: number;
  label: string | null;
  captured_at: string;
  entry_count: number;
};
/** One standings row — NEVER carries user_id (privacy boundary enforced server-side). */
export type LeaderboardEntry = {
  rank: number;
  display_name: string;
  xp: number;
  level: number;
};
export type SelectedSeason = SeasonHeader & { entries: LeaderboardEntry[] };
export type LeaderboardOverview = {
  seasons: SeasonHeader[]; // newest-first, capped at 50 by the contract
  selected: SelectedSeason | null; // null only when no season exists yet
};
export type CaptureResult = {
  season_id: string;
  season_number: number;
  captured_at: string;
  entry_count: number;
};
export type DeleteResult = {
  deleted: boolean; // false → season was absent (backend maps that to 404, handled below)
  season_number: number | null;
};

/** GET /admin/leaderboard outcome (SIM-17). Gated on STATUS; the 200 body must pass the deep
 * guard or it's a fault. NO notFound — a missing season surfaces as `selected: null`, not a 404. */
export type LeaderboardOverviewOutcome =
  | { kind: "ok"; data: LeaderboardOverview }
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "serviceUnavailable" }; // 503/500/network/timeout/malformed-200/null-client

/** POST /admin/leaderboard/capture outcome (SIM-17). Same non-200 shape as the overview read —
 * capture has no "not found" status. A 401/403 provably means NO season was committed. */
export type CaptureOutcome =
  | { kind: "ok"; data: CaptureResult }
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "serviceUnavailable" }; // 503/500/network/timeout/malformed-200/null-client

/** DELETE /admin/leaderboard/seasons/{id} outcome (SIM-17). Adds a DISTINCT `notFound` (404):
 * the backend maps the SQL `{deleted:false}` to 404, which the store treats as success. */
export type DeleteOutcome =
  | { kind: "ok"; data: DeleteResult }
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "notFound" } // 404 — season already gone; store treats as success
  | { kind: "serviceUnavailable" }; // 503/500/network/timeout/malformed-200/null-client

/** Per-request timeout: a hung/black-holed backend must not strand the UI. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Narrow the /admin/me 200 body with a real guard — no blind `as AdminMetrics` cast. */
function isProbeBody(x: unknown): x is { user_id: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Record<string, unknown>)["user_id"] === "string"
  );
}

// --- deep guard for the metrics 200 body (every leaf validated) ---------------
function rec(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null;
}
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isNumOrNull = (x: unknown): x is number | null => x === null || isNum(x);
function isEndingSplitOrNull(x: unknown): x is EndingSplit | null {
  if (x === null) return true;
  const o = rec(x);
  return o !== null && isNum(o["good"]) && isNum(o["neutral"]) && isNum(o["bad"]);
}
function isScenarioRow(x: unknown): x is ScenarioRow {
  const o = rec(x);
  return (
    o !== null &&
    typeof o["scenario_id"] === "string" &&
    typeof o["title"] === "string" &&
    isNum(o["sessions"]) &&
    isNumOrNull(o["completion_rate"]) &&
    isEndingSplitOrNull(o["ending_split"]) &&
    isNumOrNull(o["avg_score"])
  );
}
function isMetricsBody(x: unknown): x is AdminMetrics {
  const o = rec(x);
  if (o === null || typeof o["generated_at"] !== "string") return false;
  const u = rec(o["users"]);
  if (u === null || !isNum(u["active_30d"]) || !isNum(u["total_registered"]) || !isNum(u["new_7d"])) {
    return false;
  }
  const s = rec(o["sessions"]);
  if (
    s === null ||
    !isNum(s["total"]) ||
    !isNumOrNull(s["completion_rate"]) ||
    !isEndingSplitOrNull(s["ending_split"]) ||
    !isNumOrNull(s["avg_score"])
  ) {
    return false;
  }
  return Array.isArray(o["per_scenario"]) && o["per_scenario"].every(isScenarioRow);
}

// --- deep guard for the scenario-analytics 200 body (SIM-16) ------------------
// Counts use a NON-NEGATIVE-INTEGER check (isNum only checks finiteness → would wrongly accept
// negatives/floats). Scores (avg) stay isNumOrNull. by_trigger is an open count map.
const isNonNegInt = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= 0;
/** A nullable free-text field (season label). */
const isStrOrNull = (x: unknown): x is string | null => x === null || typeof x === "string";
function isCountMap(x: unknown): x is Record<string, number> {
  const o = rec(x);
  return o !== null && !Array.isArray(x) && Object.values(o).every(isNonNegInt);
}
function isEndingCounts(x: unknown): x is { good: number; neutral: number; bad: number } {
  const o = rec(x);
  return o !== null && isNonNegInt(o["good"]) && isNonNegInt(o["neutral"]) && isNonNegInt(o["bad"]);
}
function isOutcome(x: unknown): x is OutcomeBreakdown {
  const o = rec(x);
  return (
    o !== null &&
    isNonNegInt(o["completed"]) &&
    isNonNegInt(o["bubar"]) &&
    isCountMap(o["by_trigger"]) &&
    isEndingCounts(o["ending_counts"])
  );
}
function isPillar(x: unknown): x is PillarDist {
  const o = rec(x);
  return (
    o !== null &&
    typeof o["key"] === "string" &&
    isNonNegInt(o["count"]) &&
    isNumOrNull(o["avg"]) &&
    Array.isArray(o["buckets"]) &&
    o["buckets"].length === 5 && // fixed 5 bands; DistributionBars indexes positionally
    o["buckets"].every(isNonNegInt)
  );
}
function isScenarioAnalyticsBody(x: unknown): x is ScenarioAnalytics {
  const o = rec(x);
  if (
    o === null ||
    typeof o["scenario_id"] !== "string" ||
    typeof o["title"] !== "string" ||
    typeof o["generated_at"] !== "string" ||
    !isNonNegInt(o["attempts"]) ||
    !isOutcome(o["outcome"]) ||
    !isNumOrNull(o["avg_score"]) ||
    !Array.isArray(o["pillars"]) ||
    !o["pillars"].every(isPillar) ||
    o["dropoff"] !== null // Core: always null (the follow-up ticket defines the shape)
  ) {
    return false;
  }
  // Pillar keys must be unique — a duplicate would collide as a React key and silently drop a chart.
  const keys = o["pillars"].map((p) => p.key);
  return new Set(keys).size === keys.length;
}

/** Shared in-flight refresh so N concurrent 401s trigger one token rotation, not N.
 * The SOLE owner of the 401 refresh across probeAdmin + fetchMetrics. */
let refreshInFlight: Promise<string | undefined> | null = null;
function refreshOnce(): Promise<string | undefined> {
  refreshInFlight ??= (async () => {
    try {
      const { data } = await supabase!.auth.refreshSession();
      return data.session?.access_token;
    } catch {
      return undefined;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Absolute URL of a backend `path`, or null when the endpoint env is unset/invalid.
 * VITE_ADMIN_API_ENDPOINT is treated as an ORIGIN — any path in it is ignored
 * (e.g. https://api.example.com/v1 + /admin/me → https://api.example.com/admin/me). */
function adminApiUrl(path: string): string | null {
  const base = ENV.adminApiEndpoint;
  if (!base?.trim()) return null;
  try {
    return new URL(path, new URL(base).origin).href;
  } catch {
    return null;
  }
}

/** Non-response terminal outcomes shared by probe + metrics (both unions include them). */
type NoResponse = { kind: "unauthenticated" } | { kind: "authUnavailable" } | { kind: "serviceUnavailable" };

/** A request's method + a pre-serialized STRING body. GET passes `{}`. */
type RequestInitLite = { method?: string; body?: string };

/**
 * Authed request against the admin-API origin. Reads the session, attaches the Bearer ONLY
 * to that origin, and on a 401 refreshes ONCE (shared owner) and resends. Carries `init`
 * (method + string body) so the SAME closure re-applies them on the 401 resend; returns the
 * Response to classify, or a terminal NoResponse kind. A null client → authUnavailable with NO
 * network call. The SOLE owner of the 401 refresh — callers must not refresh.
 *
 * Re-sending the body on a 401 is safe for the WRITE paths (capture/delete) ONLY because the
 * backend gate (`_require_admin`) runs BEFORE the DB fn — a 401 therefore means no season was
 * ever committed, so resending cannot double-write.
 */
async function authedRequest(
  path: string,
  init: RequestInitLite = {},
  signal?: AbortSignal,
): Promise<{ kind: "response"; res: Response } | NoResponse> {
  if (!supabase) return { kind: "authUnavailable" };
  const url = adminApiUrl(path);
  if (!url) return { kind: "serviceUnavailable" };

  // One timeout for the WHOLE request including a possible 401 refresh+resend (a total-request
  // budget, not per-attempt): a slow first attempt eats into the resend's share — intended, so a
  // single hung call can't exceed REQUEST_TIMEOUT_MS end to end.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const send = (token: string): Promise<Response> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(url, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: combined,
    });
  };

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return { kind: "unauthenticated" };

    let res = await send(session.access_token);
    if (res.status === 401) {
      const refreshed = await refreshOnce();
      if (!refreshed) return { kind: "unauthenticated" };
      res = await send(refreshed);
    }
    return { kind: "response", res };
  } catch {
    // timeout, supersession-abort, or a genuine network/CORS failure → all "try again".
    return { kind: "serviceUnavailable" };
  }
}

/**
 * Probe `GET /admin/me`. Gates on STATUS, not the body. A null client → authUnavailable
 * with NO network call (do not fall through to a tokenless fetch → 401 → wrong bounce).
 */
export async function probeAdmin(signal?: AbortSignal): Promise<ProbeOutcome> {
  const r = await authedRequest("/admin/me", {}, signal);
  if (r.kind !== "response") return r;
  switch (r.res.status) {
    case 200: {
      const body: unknown = await r.res.json().catch(() => null);
      return isProbeBody(body)
        ? { kind: "authorized", userId: body.user_id }
        : { kind: "serviceUnavailable" }; // 200 but malformed → fault
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/**
 * Fetch `GET /admin/metrics` (SIM-15). Gates on STATUS; the 200 body must pass the deep
 * `isMetricsBody` guard or it's a fault (serviceUnavailable), never a half-parsed `ok`.
 * Unknown statuses (e.g. a 404 after a rollback) degrade to serviceUnavailable.
 */
export async function fetchMetrics(signal?: AbortSignal): Promise<MetricsOutcome> {
  const r = await authedRequest("/admin/metrics", {}, signal);
  // A null client (authUnavailable) is unreachable once the gate is "authorized" (that state
  // requires a non-null client); collapse it into retryable serviceUnavailable rather than
  // carry a dead terminal state into the dashboard.
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const body: unknown = await r.res.json().catch(() => null);
      return isMetricsBody(body) ? { kind: "ok", data: body } : { kind: "serviceUnavailable" };
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/**
 * Fetch `GET /admin/scenarios/{id}/analytics` (SIM-16). Gates on STATUS; the 200 body must pass
 * `isScenarioAnalyticsBody` or it's a fault (serviceUnavailable). 404 (unknown scenario) is a
 * DISTINCT terminal `notFound` — folding it into serviceUnavailable would offer a pointless retry.
 */
export async function fetchScenarioAnalytics(
  scenarioId: string,
  signal?: AbortSignal,
): Promise<ScenarioAnalyticsOutcome> {
  const r = await authedRequest(
    `/admin/scenarios/${encodeURIComponent(scenarioId)}/analytics`,
    {},
    signal,
  );
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const body: unknown = await r.res.json().catch(() => null);
      return isScenarioAnalyticsBody(body)
        ? { kind: "ok", data: body }
        : { kind: "serviceUnavailable" };
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    case 404:
      return { kind: "notFound" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

// --- SIM-17 leaderboard: deep guards for the three 200 bodies -----------------
// Counts (season_number/entry_count/xp/level/rank) use isNonNegInt (reject negatives/floats);
// label is isStrOrNull. The contract caps seasons at 50 and entries at 100 — an oversized array
// is a contract violation → treat as a fault (serviceUnavailable), never render it.
const MAX_SEASONS = 50;
const MAX_ENTRIES = 100;

function isSeasonHeader(x: unknown): x is SeasonHeader {
  const o = rec(x);
  return (
    o !== null &&
    typeof o["id"] === "string" &&
    isNonNegInt(o["season_number"]) &&
    isStrOrNull(o["label"]) &&
    typeof o["captured_at"] === "string" &&
    isNonNegInt(o["entry_count"])
  );
}

function isLeaderboardEntry(x: unknown): x is LeaderboardEntry {
  const o = rec(x);
  return (
    o !== null &&
    isNonNegInt(o["rank"]) &&
    typeof o["display_name"] === "string" &&
    isNonNegInt(o["xp"]) &&
    isNonNegInt(o["level"])
  );
}

/** The `selected` field: either null (no season) or a season header PLUS a validated entries[].
 * This guard enforces UNIQUE ranks (a dup would collide as a React key); full 1..N contiguity is a
 * DB-side invariant (UNIQUE(season_id,rank) + the capture's deterministic ranking), not re-checked
 * here. The list must not exceed the contract cap. */
function isSelectedSeason(x: unknown): x is SelectedSeason | null {
  if (x === null) return true;
  const o = rec(x);
  if (o === null) return false;
  const entries = o["entries"]; // read before isSeasonHeader narrows `o` to SeasonHeader
  if (!isSeasonHeader(o)) return false;
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || !entries.every(isLeaderboardEntry)) {
    return false;
  }
  const ranks = (entries as LeaderboardEntry[]).map((e) => e.rank);
  return new Set(ranks).size === ranks.length;
}

function isLeaderboardOverviewBody(x: unknown): x is LeaderboardOverview {
  const o = rec(x);
  return (
    o !== null &&
    Array.isArray(o["seasons"]) &&
    o["seasons"].length <= MAX_SEASONS &&
    o["seasons"].every(isSeasonHeader) &&
    isSelectedSeason(o["selected"])
  );
}

function isCaptureResult(x: unknown): x is CaptureResult {
  const o = rec(x);
  return (
    o !== null &&
    typeof o["season_id"] === "string" &&
    isNonNegInt(o["season_number"]) &&
    typeof o["captured_at"] === "string" &&
    isNonNegInt(o["entry_count"])
  );
}

function isDeleteResult(x: unknown): x is DeleteResult {
  const o = rec(x);
  return (
    o !== null &&
    typeof o["deleted"] === "boolean" &&
    (o["season_number"] === null || isNonNegInt(o["season_number"]))
  );
}

/**
 * Fetch `GET /admin/leaderboard?season_id=<uuid?>` (SIM-17). Omitting `seasonId` requests the
 * latest season. Gates on STATUS; the 200 body must pass `isLeaderboardOverviewBody` or it's a
 * fault. There is NO 404 here — a missing season is `selected: null`, not a status.
 */
export async function fetchLeaderboardOverview(
  seasonId?: string,
  signal?: AbortSignal,
): Promise<LeaderboardOverviewOutcome> {
  const q = seasonId ? `?season_id=${encodeURIComponent(seasonId)}` : "";
  const r = await authedRequest(`/admin/leaderboard${q}`, {}, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const body: unknown = await r.res.json().catch(() => null);
      return isLeaderboardOverviewBody(body) ? { kind: "ok", data: body } : { kind: "serviceUnavailable" };
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/**
 * Capture a snapshot via `POST /admin/leaderboard/capture` (SIM-17). `label` null → empty body.
 *
 * The 401 resend inside `authedRequest` is safe HERE ONLY because the backend gate
 * (`_require_admin`) runs BEFORE the DB fn — a 401/403 means no season was committed, so the
 * store can state plainly "musim tidak tersimpan". A 503, by contrast, may have committed
 * server-side (timeout after commit) → the store refetches the overview.
 */
export async function captureLeaderboardSnapshot(
  label: string | null,
  signal?: AbortSignal,
): Promise<CaptureOutcome> {
  const body = JSON.stringify(label === null ? {} : { label });
  const r = await authedRequest("/admin/leaderboard/capture", { method: "POST", body }, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const b: unknown = await r.res.json().catch(() => null);
      return isCaptureResult(b) ? { kind: "ok", data: b } : { kind: "serviceUnavailable" };
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/**
 * Delete a season via `DELETE /admin/leaderboard/seasons/{id}` (SIM-17). A 404 (season already
 * gone) is a DISTINCT `notFound` the store treats as success — folding it into serviceUnavailable
 * would offer a pointless retry on an already-deleted season.
 */
export async function deleteLeaderboardSeason(
  seasonId: string,
  signal?: AbortSignal,
): Promise<DeleteOutcome> {
  const r = await authedRequest(
    `/admin/leaderboard/seasons/${encodeURIComponent(seasonId)}`,
    { method: "DELETE" },
    signal,
  );
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const b: unknown = await r.res.json().catch(() => null);
      return isDeleteResult(b) ? { kind: "ok", data: b } : { kind: "serviceUnavailable" };
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    case 404:
      return { kind: "notFound" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

// --- SIM-18 quiz content management ------------------------------------------
// Admin CRUD over quiz_definition. Unlike the leaderboard unions, the WRITE adds terminal
// `rejected` (422 input validation) and `conflict` (409 duplicate_code/stale_write) members, and
// delete adds `blocked` (409 has_completions). A 409 body carrying an UNKNOWN reason is a fault
// (serviceUnavailable), never a silently-generic conflict — the reason literal is validated.

/** A full admin quiz row — INCLUDES correct_index/explanation that the game's quiz_catalog hides. */
export type QuizQuestion = {
  code: string;
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  sort_order: number;
  updated_at: string;
};

/** Upsert input. `prev_updated_at` null → CREATE; a value → compare-and-swap EDIT (echo the
 * `updated_at` from the loaded row verbatim). */
export type QuizUpsertInput = {
  code: string;
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  sort_order: number;
  prev_updated_at: string | null;
};

export type QuizListOutcome =
  | { kind: "ok"; data: QuizQuestion[] }
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "serviceUnavailable" }; // 503/500/network/timeout/malformed-200/null-client

export type QuizUpsertOutcome =
  | { kind: "ok"; data: QuizQuestion }
  | { kind: "rejected"; reason: string } // 422 — server-side validation (defense-in-depth)
  | { kind: "conflict"; reason: "duplicate_code" | "stale_write" } // 409
  | { kind: "notFound" } // 404 — editing a code that no longer exists
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "serviceUnavailable" };

export type QuizDeleteOutcome =
  | { kind: "ok" }
  | { kind: "blocked"; reason: "has_completions" } // 409 — answered question, undeletable
  | { kind: "notFound" } // 404 — already gone (treated as success by the store)
  | { kind: "notAuthorized" } // 403
  | { kind: "unauthenticated" } // 401 after one refresh
  | { kind: "serviceUnavailable" };

const isStrArray = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((s) => typeof s === "string");

/** Deep, CLOSED guard for an admin quiz row: enforces the 2..4 options cap and that correct_index
 * is a valid index — a malformed 200 is a fault, never rendered as a broken answer key. */
function isQuizQuestion(x: unknown): x is QuizQuestion {
  const o = rec(x);
  if (
    o === null ||
    typeof o["code"] !== "string" ||
    typeof o["prompt"] !== "string" ||
    !isStrArray(o["options"]) ||
    !isNonNegInt(o["correct_index"]) ||
    !isStrOrNull(o["explanation"]) ||
    !isNonNegInt(o["sort_order"]) ||
    typeof o["updated_at"] !== "string"
  ) {
    return false;
  }
  const opts = o["options"] as string[];
  return opts.length >= 2 && opts.length <= 4 && (o["correct_index"] as number) < opts.length;
}

/** Read a FastAPI error body's `{detail}` reason string (empty when absent/malformed). */
async function errorReason(res: Response): Promise<string> {
  const b: unknown = await res.json().catch(() => null);
  const o = rec(b);
  return o !== null && typeof o["detail"] === "string" ? o["detail"] : "";
}

/** Fetch `GET /admin/quiz` (SIM-18). Returns the full rows (incl the hidden answer key) for editing. */
export async function listQuiz(signal?: AbortSignal): Promise<QuizListOutcome> {
  const r = await authedRequest("/admin/quiz", {}, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const b: unknown = await r.res.json().catch(() => null);
      const o = rec(b);
      if (o === null || o["ok"] !== true || !Array.isArray(o["rows"]) || !o["rows"].every(isQuizQuestion)) {
        return { kind: "serviceUnavailable" }; // malformed 200 → fault
      }
      return { kind: "ok", data: o["rows"] as QuizQuestion[] };
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/** Create or compare-and-swap edit via `POST /admin/quiz` (SIM-18). The 401-resend is safe because
 * the backend gate precedes the DB fn; a 503 is ambiguous (may have committed) → the store refetches. */
export async function upsertQuizQuestion(
  input: QuizUpsertInput,
  signal?: AbortSignal,
): Promise<QuizUpsertOutcome> {
  const r = await authedRequest("/admin/quiz", { method: "POST", body: JSON.stringify(input) }, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const b: unknown = await r.res.json().catch(() => null);
      return isQuizQuestion(b) ? { kind: "ok", data: b } : { kind: "serviceUnavailable" };
    }
    case 409: {
      const reason = await errorReason(r.res);
      return reason === "duplicate_code" || reason === "stale_write"
        ? { kind: "conflict", reason }
        : { kind: "serviceUnavailable" }; // unknown 409 reason = fault
    }
    case 422:
      return { kind: "rejected", reason: await errorReason(r.res) };
    case 404:
      return { kind: "notFound" };
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/** Delete via `DELETE /admin/quiz/{code}` (SIM-18). 409 has_completions is a distinct `blocked`
 * (answered questions are undeletable); 404 is `notFound` (already gone). */
export async function deleteQuizQuestion(
  code: string,
  signal?: AbortSignal,
): Promise<QuizDeleteOutcome> {
  const r = await authedRequest(`/admin/quiz/${encodeURIComponent(code)}`, { method: "DELETE" }, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200:
      return { kind: "ok" };
    case 409: {
      const reason = await errorReason(r.res);
      return reason === "has_completions"
        ? { kind: "blocked", reason }
        : { kind: "serviceUnavailable" };
    }
    case 404:
      return { kind: "notFound" };
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

// --- SIM-18 mading content management ---------------------------------------
// Admin CRUD over the 4 mading boards. The admin layer treats `payload` loosely (a record) — the
// panel builds/interprets the board-specific shape and the SERVER is the authoritative validator
// (422 `rejected`). The learner-facing web repo re-validates with the closed parsers.

export type MadingBoard = "info" | "data" | "knowledge" | "identitas";

export type MadingItem = {
  id: string;
  block_key: string;
  payload: Record<string, unknown>;
  sort_order: number;
  updated_at: string;
};

export type MadingGroups = {
  info: MadingItem[];
  data: MadingItem[];
  knowledge: MadingItem[];
  identitas: MadingItem | null;
};

/** Upsert input. `id` null → CREATE (block_key required); a value → compare-and-swap EDIT. */
export type MadingUpsertInput = {
  id: string | null;
  board: MadingBoard;
  block_key: string;
  payload: Record<string, unknown>;
  sort_order: number;
  prev_updated_at: string | null;
};

export type MadingListOutcome =
  | { kind: "ok"; data: MadingGroups }
  | { kind: "notAuthorized" }
  | { kind: "unauthenticated" }
  | { kind: "serviceUnavailable" };

export type MadingUpsertOutcome =
  | { kind: "ok"; data: MadingItem & { board: MadingBoard } }
  | { kind: "rejected"; reason: string } // 422 — server payload/input validation
  | { kind: "conflict"; reason: "duplicate_key" | "stale_write" | "identitas_exists" } // 409
  | { kind: "notFound" } // 404
  | { kind: "notAuthorized" }
  | { kind: "unauthenticated" }
  | { kind: "serviceUnavailable" };

export type MadingDeleteOutcome =
  | { kind: "ok" }
  | { kind: "notFound" } // 404 — already gone (store treats as success)
  | { kind: "notAuthorized" }
  | { kind: "unauthenticated" }
  | { kind: "serviceUnavailable" };

function isMadingItem(x: unknown): x is MadingItem {
  const o = rec(x);
  return (
    o !== null &&
    typeof o["id"] === "string" &&
    typeof o["block_key"] === "string" &&
    rec(o["payload"]) !== null &&
    isNonNegInt(o["sort_order"]) &&
    typeof o["updated_at"] === "string"
  );
}

function isMadingGroups(x: unknown): x is MadingGroups {
  const o = rec(x);
  if (o === null) return false;
  for (const k of ["info", "data", "knowledge"]) {
    if (!Array.isArray(o[k]) || !o[k].every(isMadingItem)) return false;
  }
  return o["identitas"] === null || isMadingItem(o["identitas"]);
}

const MADING_CONFLICT = ["duplicate_key", "stale_write", "identitas_exists"] as const;

/** Fetch `GET /admin/mading` (SIM-18) — all blocks grouped by board (incl id + CAS token). */
export async function listMading(signal?: AbortSignal): Promise<MadingListOutcome> {
  const r = await authedRequest("/admin/mading", {}, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const b: unknown = await r.res.json().catch(() => null);
      const o = rec(b);
      return o !== null && o["ok"] === true && isMadingGroups(o["groups"])
        ? { kind: "ok", data: o["groups"] }
        : { kind: "serviceUnavailable" };
    }
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/** Create (id null) or compare-and-swap edit a mading block (SIM-18). */
export async function upsertMadingBlock(
  input: MadingUpsertInput,
  signal?: AbortSignal,
): Promise<MadingUpsertOutcome> {
  const path = input.id === null ? "/admin/mading" : `/admin/mading/${encodeURIComponent(input.id)}`;
  const body = JSON.stringify(
    input.id === null
      ? { board: input.board, block_key: input.block_key, payload: input.payload, sort_order: input.sort_order }
      : { board: input.board, payload: input.payload, sort_order: input.sort_order, prev_updated_at: input.prev_updated_at },
  );
  const r = await authedRequest(path, { method: "POST", body }, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200: {
      const b: unknown = await r.res.json().catch(() => null);
      const o = rec(b);
      return isMadingItem(b) && o !== null && typeof o["board"] === "string"
        ? { kind: "ok", data: { ...(b as MadingItem), board: o["board"] as MadingBoard } }
        : { kind: "serviceUnavailable" };
    }
    case 409: {
      const reason = await errorReason(r.res);
      return (MADING_CONFLICT as readonly string[]).includes(reason)
        ? { kind: "conflict", reason: reason as (typeof MADING_CONFLICT)[number] }
        : { kind: "serviceUnavailable" };
    }
    case 422:
      return { kind: "rejected", reason: await errorReason(r.res) };
    case 404:
      return { kind: "notFound" };
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}

/** Delete via `DELETE /admin/mading/{id}` (SIM-18). */
export async function deleteMadingBlock(id: string, signal?: AbortSignal): Promise<MadingDeleteOutcome> {
  const r = await authedRequest(`/admin/mading/${encodeURIComponent(id)}`, { method: "DELETE" }, signal);
  if (r.kind !== "response") return r.kind === "authUnavailable" ? { kind: "serviceUnavailable" } : r;
  switch (r.res.status) {
    case 200:
      return { kind: "ok" };
    case 404:
      return { kind: "notFound" };
    case 403:
      return { kind: "notAuthorized" };
    case 401:
      return { kind: "unauthenticated" };
    default:
      return { kind: "serviceUnavailable" };
  }
}
