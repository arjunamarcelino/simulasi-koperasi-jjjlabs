import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { fetchMetrics, type AdminMetrics } from "../lib/adminApi";
import { adminAuthStore } from "./adminAuth.store";

/**
 * Dashboard metrics store (SIM-15). Independent of the SIM-14 auth gate — it owns the
 * data-fetch state machine, NOT the gate. On auth-loss it is strictly SUBORDINATE to the
 * gate: it hands off ONCE (re-probe /admin/me via the gate's single writer) and goes
 * passive, never writing the gate itself and never auto-looping.
 */
export type MetricsState =
  | { status: "loading" }
  | { status: "ready"; data: AdminMetrics }
  | { status: "error" } // retryable (serviceUnavailable) — manual "Coba lagi"
  | { status: "authLost" }; // handed to the gate; passive spinner, NO retry button

export type DashboardMetricsState = {
  state: MetricsState;
  /** Fetch metrics for the authorized `userId` — ONCE per userId (StrictMode / gate
   * re-affirm of the same userId does not refire). Call from DashboardPage's mount effect. */
  load: (userId: string) => void;
  /** Manual refetch (the error screen's "Coba lagi"). */
  retry: () => void;
  /** Abort + reset on unmount (gate left "authorized"). */
  dispose: () => void;
};

let epoch = 0;
let currentAbort: AbortController | null = null;
let activeUserId: string | null = null;
let bridgedUserId: string | null = null; // one-shot auth-loss bridge latch, per userId

async function run(): Promise<void> {
  const myEpoch = ++epoch;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;
  dashboardMetricsStore.setState({ state: { status: "loading" } });

  const outcome = await fetchMetrics(ac.signal);
  // Epoch guard wraps BOTH the setState AND the bridge: an aborted fetch rejects →
  // becomes a plausible serviceUnavailable/unauthenticated outcome; without this a stale
  // result would write state or fire the gate bridge from a superseded/unmounted run.
  if (myEpoch !== epoch) return;

  switch (outcome.kind) {
    case "ok":
      dashboardMetricsStore.setState({ state: { status: "ready", data: outcome.data } });
      break;
    case "serviceUnavailable":
      dashboardMetricsStore.setState({ state: { status: "error" } });
      break;
    case "unauthenticated":
    case "notAuthorized":
      handleAuthLoss(myEpoch);
      break;
  }
}

/** Bounded auth-loss bridge: at most ONE gate re-probe per authorized userId. A second
 * auth-loss while the gate still says "authorized" falls to a manual-retry error state —
 * this is what prevents the /admin/metrics-403 vs /admin/me-200 disagreement spiral. */
function handleAuthLoss(myEpoch: number): void {
  if (activeUserId !== null && bridgedUserId === activeUserId) {
    dashboardMetricsStore.setState({ state: { status: "error" } });
    return;
  }
  bridgedUserId = activeUserId;
  dashboardMetricsStore.setState({ state: { status: "authLost" } });
  // Re-probe /admin/me through the gate's single writer → it flips to unauthenticated
  // (→ LoginForm) or notAuthorized (→ NotAuthorized), which unmounts us. We never write
  // the gate directly.
  void (async () => {
    await adminAuthStore.getState().retry();
    if (myEpoch !== epoch) return; // disposed / superseded → drop
    // Gate re-affirmed "authorized" (the two probes disagree) → don't sit on a spinner;
    // surface a manual retry. The one-shot latch prevents this from auto-looping.
    if (adminAuthStore.getState().gate.status === "authorized") {
      dashboardMetricsStore.setState({ state: { status: "error" } });
    }
  })();
}

export const dashboardMetricsStore = createStore<DashboardMetricsState>()(() => ({
  state: { status: "loading" },

  load: (userId) => {
    if (userId === activeUserId) return; // fetch once per authorized userId (StrictMode-safe)
    activeUserId = userId;
    bridgedUserId = null; // a fresh authorized session re-arms the one-shot bridge
    void run();
  },

  retry: () => {
    void run(); // manual refetch; does NOT reset the per-userId bridge latch
  },

  dispose: () => {
    epoch++; // bump before abort so the in-flight result is dropped by the guard
    currentAbort?.abort();
    currentAbort = null;
    activeUserId = null;
    bridgedUserId = null;
    dashboardMetricsStore.setState({ state: { status: "loading" } });
  },
}));

/** Test-only reset of module singletons. */
export function __resetDashboardMetricsForTest(): void {
  epoch = 0;
  currentAbort = null;
  activeUserId = null;
  bridgedUserId = null;
  dashboardMetricsStore.setState({ state: { status: "loading" } });
}

export function useDashboardMetrics<T>(selector: (s: DashboardMetricsState) => T): T {
  return useStore(dashboardMetricsStore, selector);
}
