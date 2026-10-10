import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  captureLeaderboardSnapshot,
  deleteLeaderboardSeason,
  fetchLeaderboardOverview,
  type LeaderboardOverview,
} from "../lib/adminApi";
import { adminAuthStore } from "./adminAuth.store";
import { assertNever } from "../lib/assertNever";

/**
 * Seasonal leaderboard store (SIM-17). A read machine mirroring scenarioAnalytics/dashboardMetrics
 * (epoch + AbortController supersession on the READS, one-shot `bridged` → handleAuthLoss, a
 * "loaded default yet" guard for StrictMode), plus WRITE mutations (capture/delete) that the reads
 * do not. Race-hardening that MUST hold (see the plan's frontend-races review):
 *
 *   - mutation-in-flight lives INSIDE the `ready` union (`mutating`), never an orthogonal boolean,
 *     and `ready` keeps `data.seasons` visible while `switching` so the dropdown never vanishes;
 *   - mutations are NOT abortable and do NOT share the read's `currentAbort`. Each snapshots
 *     `myEpoch = epoch` at dispatch (NO ++) and gates its ENTIRE tail on `myEpoch === epoch`, so a
 *     result arriving after reset()/dispose()/a switch is dropped (the "zombie capture" that would
 *     otherwise reopen a closed panel or fire a stale toast);
 *   - ONE mutation gate blocks capture, ALL deletes, AND the season switch while a write (or its
 *     trailing `switching` refetch) is in flight → no double-click, no capture∥delete, no
 *     delete∥delete, and no mid-write season switch (which would ++epoch, drop the committed
 *     capture's tail, and reopen the gate). Cleared in a finally (epoch-guarded) + by reset();
 *   - ONE shared `bridged` latch; capture/delete route 401/403 through the gate's handleAuthLoss,
 *     never a direct adminAuthStore.retry();
 *   - after capture ok, select the RETURNED season_id (correct even under a concurrent capture);
 *     on capture 503 refetch (may have committed); on capture 401/403 state plainly "not saved".
 */
export type Mutating = "capturing" | { deleting: string } | null;

export type LeaderboardUiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: LeaderboardOverview; switching: boolean; mutating: Mutating }
  | { status: "error" } // retryable (serviceUnavailable)
  | { status: "authLost" }; // passive; gate re-probe drives the transition

export type Toast = { tone: "success" | "error"; text: string };

export type LeaderboardStoreState = {
  state: LeaderboardUiState;
  /** Transient feedback for the last mutation; survives a `switching` refetch, cleared on reset. */
  toast: Toast | null;
  /** Fetch the default (latest) overview ONCE (StrictMode-safe). Call from the mount effect. */
  load: () => void;
  /** Manual refetch of the current selection (the error screen's "Coba lagi"). */
  retry: () => void;
  /** Switch the shown season; keeps the list visible (`switching`) while the fetch is in flight. */
  select: (seasonId: string) => void;
  /** Capture a new snapshot (optional label). Blocked while any mutation is in flight. */
  capture: (label: string | null) => void;
  /** Delete a season. Blocked while any mutation is in flight. */
  remove: (seasonId: string) => void;
  /** Abort reads + reset to idle on unmount. */
  dispose: () => void;
};

let epoch = 0;
let currentAbort: AbortController | null = null; // READS only (mutations are not abortable)
let bridged = false; // one-shot auth-loss bridge latch, shared by read + capture + delete
let loadedDefault = false; // "loaded the default yet" guard (StrictMode double-mount)
let currentSeasonId: string | undefined = undefined; // the selection to (re)fetch; undefined = latest

/** Set the toast only if `myEpoch` is still current (drops a zombie toast after reset/switch). */
function setToast(myEpoch: number, toast: Toast): void {
  if (myEpoch !== epoch) return;
  leaderboardStore.setState({ toast });
}

/** Safety net: clear the mutation gate if it's still set under the same epoch. The normal exit is
 * via a `switching` refetch (runOverview resets `mutating`); this covers any path that doesn't. */
function clearMutating(myEpoch: number): void {
  if (myEpoch !== epoch) return;
  const s = leaderboardStore.getState().state;
  if (s.status === "ready" && s.mutating !== null) {
    leaderboardStore.setState({ state: { ...s, mutating: null } });
  }
}

function reset(): void {
  epoch++; // bump before abort so the in-flight read is dropped by the guard
  currentAbort?.abort();
  currentAbort = null;
  bridged = false;
  loadedDefault = false;
  currentSeasonId = undefined;
  leaderboardStore.setState({ state: { status: "idle" }, toast: null });
}

/** Fetch the overview for `seasonId` (undefined = latest). `switching:true` keeps the current
 * `ready` data (and its seasons list) visible and clears `mutating`; otherwise shows a spinner. */
async function runOverview(seasonId: string | undefined, opts: { switching: boolean }): Promise<void> {
  const myEpoch = ++epoch;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;

  const cur = leaderboardStore.getState().state;
  if (opts.switching && cur.status === "ready") {
    leaderboardStore.setState({
      state: { status: "ready", data: cur.data, switching: true, mutating: null },
    });
  } else {
    leaderboardStore.setState({ state: { status: "loading" } });
  }

  const outcome = await fetchLeaderboardOverview(seasonId, ac.signal);
  if (myEpoch !== epoch) return; // superseded (switch) / reset → drop

  switch (outcome.kind) {
    case "ok":
      bridged = false; // auth clearly fine → re-arm the bridge for a future loss
      leaderboardStore.setState({
        state: { status: "ready", data: outcome.data, switching: false, mutating: null },
      });
      break;
    case "serviceUnavailable":
      leaderboardStore.setState({ state: { status: "error" } });
      break;
    case "unauthenticated":
    case "notAuthorized":
      handleAuthLoss(myEpoch);
      break;
    default:
      assertNever(outcome);
  }
}

async function runCapture(label: string | null): Promise<void> {
  const s0 = leaderboardStore.getState().state;
  // Mutation gate: block while a write OR its trailing `switching` refetch is in flight (a
  // post-success refetch clears `mutating` but the write isn't truly settled until it resolves).
  if (s0.status !== "ready" || s0.mutating !== null || s0.switching) return;
  const myEpoch = epoch; // snapshot (NOT ++): a later reset/switch bumps epoch → drops this tail
  leaderboardStore.setState({ state: { ...s0, mutating: "capturing" } });
  try {
    // NOT abortable, no signal: a capture must either land or fail on its own terms.
    // The 401-resend inside captureLeaderboardSnapshot is safe only because auth precedes the DB fn.
    const outcome = await captureLeaderboardSnapshot(label);
    if (myEpoch !== epoch) return; // zombie: reset()/switch happened → drop entirely
    switch (outcome.kind) {
      case "ok":
        setToast(myEpoch, {
          tone: "success",
          text: `Musim #${outcome.data.season_number} tersimpan — ${outcome.data.entry_count} peserta`,
        });
        // Select the RETURNED id (not latest) → correct even if another admin captured concurrently.
        currentSeasonId = outcome.data.season_id;
        void runOverview(outcome.data.season_id, { switching: true });
        break;
      case "serviceUnavailable":
        // May have committed server-side (timeout after commit) → refetch to reflect the truth.
        setToast(myEpoch, { tone: "error", text: "Status tidak pasti — memuat ulang daftar musim…" });
        void runOverview(currentSeasonId, { switching: true });
        break;
      case "unauthenticated":
      case "notAuthorized":
        // Auth precedes the DB fn ⇒ provably NOT committed.
        setToast(myEpoch, { tone: "error", text: "Musim tidak tersimpan — sesi admin berakhir." });
        handleAuthLoss(myEpoch);
        break;
      default:
        assertNever(outcome);
    }
  } finally {
    clearMutating(myEpoch);
  }
}

async function runRemove(seasonId: string): Promise<void> {
  const s0 = leaderboardStore.getState().state;
  // Mutation gate: block while a write OR its trailing `switching` refetch is in flight.
  if (s0.status !== "ready" || s0.mutating !== null || s0.switching) return;
  const myEpoch = epoch; // snapshot (NOT ++)
  const selectedId = s0.data.selected?.id ?? null;
  leaderboardStore.setState({ state: { ...s0, mutating: { deleting: seasonId } } });
  try {
    const outcome = await deleteLeaderboardSeason(seasonId);
    if (myEpoch !== epoch) return; // zombie → drop
    switch (outcome.kind) {
      case "ok":
      case "notFound": {
        // 404 treated as success — the season is already gone; just refresh the list.
        const num = outcome.kind === "ok" ? outcome.data.season_number : null;
        setToast(myEpoch, {
          tone: "success",
          text: num === null ? "Musim sudah terhapus." : `Musim #${num} dihapus.`,
        });
        // Reselect latest ONLY when the deleted season was the selected one (clear the selected id
        // BEFORE the epoch-guarded refetch so overview(latest) resolves the next season);
        // otherwise keep showing the current selection.
        currentSeasonId = seasonId === selectedId ? undefined : selectedId ?? undefined;
        void runOverview(currentSeasonId, { switching: true });
        break;
      }
      case "serviceUnavailable":
        // May have committed → refetch (reselecting latest if the maybe-deleted one was selected).
        setToast(myEpoch, { tone: "error", text: "Status tidak pasti — memuat ulang daftar musim…" });
        currentSeasonId = seasonId === selectedId ? undefined : selectedId ?? undefined;
        void runOverview(currentSeasonId, { switching: true });
        break;
      case "unauthenticated":
      case "notAuthorized":
        setToast(myEpoch, { tone: "error", text: "Musim tidak terhapus — sesi admin berakhir." });
        handleAuthLoss(myEpoch);
        break;
      default:
        assertNever(outcome);
    }
  } finally {
    clearMutating(myEpoch);
  }
}

/** At most ONE gate re-probe per auth-loss (shared latch across read + capture + delete). A second
 * loss before a successful load falls to a manual-retry error — same discipline as the other
 * stores, preventing a re-probe spiral. We NEVER write the gate directly. */
function handleAuthLoss(myEpoch: number): void {
  if (bridged) {
    leaderboardStore.setState({ state: { status: "error" } });
    return;
  }
  bridged = true;
  leaderboardStore.setState({ state: { status: "authLost" } });
  void (async () => {
    await adminAuthStore.getState().retry();
    if (myEpoch !== epoch) return; // disposed / superseded → drop
    if (adminAuthStore.getState().gate.status === "authorized") {
      // Gate disagrees (still authorized) → don't sit on a spinner; offer manual retry.
      leaderboardStore.setState({ state: { status: "error" } });
    }
  })();
}

export const leaderboardStore = createStore<LeaderboardStoreState>()(() => ({
  state: { status: "idle" },
  toast: null,

  load: () => {
    if (loadedDefault) return; // fetch the default once (StrictMode-safe)
    loadedDefault = true;
    bridged = false;
    currentSeasonId = undefined;
    void runOverview(undefined, { switching: false });
  },

  retry: () => {
    void runOverview(currentSeasonId, { switching: false });
  },

  select: (seasonId) => {
    // Gate the season switch on an in-flight WRITE. A switch calls runOverview → ++epoch, which
    // would drop a committed capture's tail AND clear `mutating`, reopening the gate for a second
    // concurrent write. (A switch during a plain read refetch is fine — supersession handles it.)
    const s = leaderboardStore.getState().state;
    if (s.status === "ready" && s.mutating !== null) return;
    currentSeasonId = seasonId;
    void runOverview(seasonId, { switching: true });
  },

  capture: (label) => {
    void runCapture(label);
  },

  remove: (seasonId) => {
    void runRemove(seasonId);
  },

  dispose: () => reset(),
}));

/** Test-only reset of module singletons. */
export function __resetLeaderboardForTest(): void {
  epoch = 0;
  currentAbort = null;
  bridged = false;
  loadedDefault = false;
  currentSeasonId = undefined;
  leaderboardStore.setState({ state: { status: "idle" }, toast: null });
}

export function useLeaderboard<T>(selector: (s: LeaderboardStoreState) => T): T {
  return useStore(leaderboardStore, selector);
}
