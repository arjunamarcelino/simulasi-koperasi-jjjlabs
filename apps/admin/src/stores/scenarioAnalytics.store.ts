import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { fetchScenarioAnalytics, type ScenarioAnalytics } from "../lib/adminApi";
import { adminAuthStore } from "./adminAuth.store";

/**
 * Per-scenario drill-down store (SIM-16). A SINGLE active slot (not a cache): `scenarioId` is the
 * subject of whatever is currently loaded, mirroring dashboardMetrics.store's epoch+abort machine.
 * Differences, because this store has MANY subjects (the user clicks different rows):
 *   - a real `idle` state (nothing selected), distinct from `loading`; `close()` resets to idle
 *     (the panel stays mounted under the table, so resetting to "loading" would spin forever);
 *   - every non-idle variant CARRIES its scenarioId so the row highlight derives from the store,
 *     not a parallel local useState that could desync on auth-loss;
 *   - `open(sameId)` toggles the panel closed; every `open()` refetches (no stale cache);
 *   - `notFound` (404) is terminal with no retry;
 *   - auth-loss bridges to the gate ONCE (latch reset on a successful load / on close), NOT per
 *     scenario click — re-keying the latch on scenarioId would re-probe on every click.
 */
export type ScenarioAnalyticsUiState =
  | { status: "idle" }
  | { status: "loading"; scenarioId: string }
  | { status: "ready"; scenarioId: string; data: ScenarioAnalytics }
  | { status: "error"; scenarioId: string } // retryable (serviceUnavailable)
  | { status: "notFound"; scenarioId: string } // 404 — no retry
  | { status: "authLost"; scenarioId: string }; // passive; gate re-probe drives the transition

export type ScenarioAnalyticsStoreState = {
  state: ScenarioAnalyticsUiState;
  /** Open (fetch) a scenario; calling with the already-open scenario toggles it closed. */
  open: (scenarioId: string) => void;
  /** Manual refetch for the current scenario (the error screen's "Coba lagi"). */
  retry: () => void;
  /** Collapse the panel: abort in-flight, reset to idle. */
  close: () => void;
};

let epoch = 0;
let currentAbort: AbortController | null = null;
let openScenarioId: string | null = null;
let bridged = false; // one-shot auth-loss bridge latch (reset on ready / close)

function reset(): void {
  epoch++; // bump before abort so the in-flight result is dropped by the guard
  currentAbort?.abort();
  currentAbort = null;
  openScenarioId = null;
  bridged = false;
  scenarioAnalyticsStore.setState({ state: { status: "idle" } });
}

async function run(scenarioId: string): Promise<void> {
  const myEpoch = ++epoch;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;
  scenarioAnalyticsStore.setState({ state: { status: "loading", scenarioId } });

  const outcome = await fetchScenarioAnalytics(scenarioId, ac.signal);
  if (myEpoch !== epoch) return; // superseded (rapid switch) / closed → drop

  switch (outcome.kind) {
    case "ok":
      bridged = false; // auth clearly fine → re-arm the bridge for a future loss
      scenarioAnalyticsStore.setState({ state: { status: "ready", scenarioId, data: outcome.data } });
      break;
    case "serviceUnavailable":
      scenarioAnalyticsStore.setState({ state: { status: "error", scenarioId } });
      break;
    case "notFound":
      scenarioAnalyticsStore.setState({ state: { status: "notFound", scenarioId } });
      break;
    case "unauthenticated":
    case "notAuthorized":
      handleAuthLoss(scenarioId, myEpoch);
      break;
  }
}

/** At most ONE gate re-probe per auth-loss (latch). A second loss before a successful load falls
 * to a manual-retry error — same discipline as dashboardMetrics, preventing a re-probe spiral. */
function handleAuthLoss(scenarioId: string, myEpoch: number): void {
  if (bridged) {
    scenarioAnalyticsStore.setState({ state: { status: "error", scenarioId } });
    return;
  }
  bridged = true;
  scenarioAnalyticsStore.setState({ state: { status: "authLost", scenarioId } });
  // Re-probe /admin/me via the gate's single writer → it flips to unauthenticated / notAuthorized
  // (App unmounts the dashboard). We never write the gate directly.
  void (async () => {
    await adminAuthStore.getState().retry();
    if (myEpoch !== epoch) return; // disposed / superseded → drop
    if (adminAuthStore.getState().gate.status === "authorized") {
      // gate disagrees (still authorized) → don't sit on a spinner; offer manual retry.
      scenarioAnalyticsStore.setState({ state: { status: "error", scenarioId } });
    }
  })();
}

export const scenarioAnalyticsStore = createStore<ScenarioAnalyticsStoreState>()(() => ({
  state: { status: "idle" },

  open: (scenarioId) => {
    if (openScenarioId === scenarioId) {
      reset(); // clicking the open row again collapses it
      return;
    }
    openScenarioId = scenarioId;
    void run(scenarioId);
  },

  retry: () => {
    if (openScenarioId) void run(openScenarioId);
  },

  close: () => reset(),
}));

/** Test-only reset of module singletons. */
export function __resetScenarioAnalyticsForTest(): void {
  epoch = 0;
  currentAbort = null;
  openScenarioId = null;
  bridged = false;
  scenarioAnalyticsStore.setState({ state: { status: "idle" } });
}

export function useScenarioAnalytics<T>(selector: (s: ScenarioAnalyticsStoreState) => T): T {
  return useStore(scenarioAnalyticsStore, selector);
}
