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
  return (
    o !== null &&
    typeof o["scenario_id"] === "string" &&
    typeof o["title"] === "string" &&
    typeof o["generated_at"] === "string" &&
    isNonNegInt(o["attempts"]) &&
    isOutcome(o["outcome"]) &&
    isNumOrNull(o["avg_score"]) &&
    Array.isArray(o["pillars"]) &&
    o["pillars"].every(isPillar) &&
    o["dropoff"] === null // Core: always null (the follow-up ticket defines the shape)
  );
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

/**
 * Authed GET against the admin-API origin. Reads the session, attaches the Bearer ONLY
 * to that origin, and on a 401 refreshes ONCE (shared owner) and resends. Returns the
 * Response to classify, or a terminal NoResponse kind. A null client → authUnavailable
 * with NO network call. The SOLE owner of the 401 refresh — callers must not refresh.
 */
async function authedGet(
  path: string,
  signal?: AbortSignal,
): Promise<{ kind: "response"; res: Response } | NoResponse> {
  if (!supabase) return { kind: "authUnavailable" };
  const url = adminApiUrl(path);
  if (!url) return { kind: "serviceUnavailable" };

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const send = (token: string): Promise<Response> =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: combined });

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
  const r = await authedGet("/admin/me", signal);
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
  const r = await authedGet("/admin/metrics", signal);
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
  const r = await authedGet(`/admin/scenarios/${encodeURIComponent(scenarioId)}/analytics`, signal);
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
