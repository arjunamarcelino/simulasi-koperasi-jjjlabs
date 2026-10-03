import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { supabase } from "../lib/supabase";
import { probeAdmin } from "../lib/adminApi";
import { mapAuthError, type LoginErrorKind } from "../lib/mapAuthError";

/**
 * Admin auth gate store (SIM-14). Single-writer discipline: the resolved gate
 * (authorized/notAuthorized/unauthenticated/serviceUnavailable/authUnavailable) is
 * written ONLY from the onAuthStateChange listener's probe, never an action tail.
 *
 * Divergences from the game's auth.store that MUST hold:
 *   - NEVER signInAnonymously — an anonymous admin is nonsense (the gate is
 *     is_admin AND NOT is_anonymous). SIGNED_OUT → unauthenticated, full stop.
 *   - The probe is an AUTH CALL (it reads getSession/refreshSession → GoTrue lock),
 *     so it is always fired via queueMicrotask out of the callback.
 *   - Dedup on the access token (collapses INITIAL_SESSION + SIGNED_IN + cross-tab to
 *     one request); only TOKEN_REFRESHED's new token re-probes. A monotonic epoch
 *     drops stale async results.
 */

export type GateState =
  | { status: "loading" }
  | { status: "authUnavailable" } // terminal: no Supabase env
  | { status: "unauthenticated"; loginError: LoginErrorKind | null; signingIn: boolean }
  | { status: "authorized"; userId: string }
  | { status: "notAuthorized"; refreshing: boolean }
  | { status: "serviceUnavailable"; transient: boolean };

export type AdminAuthState = {
  gate: GateState;
  /** Sign in with email/password (+ optional Turnstile token). On success the probe
   * runs via the SIGNED_IN event; on error the gate stays unauthenticated with a kind. */
  signIn: (email: string, password: string, captchaToken?: string) => Promise<void>;
  /** Global sign-out (revokes the refresh token server-side). → unauthenticated. */
  signOut: () => Promise<void>;
  /** 403 screen: refresh the session so a just-promoted admin's new token carries the
   * claim; the TOKEN_REFRESHED re-probe (single owner) then unlocks or re-denies. */
  refreshAndRetry: () => Promise<void>;
  /** serviceUnavailable screen: re-probe the current session manually. */
  retry: () => Promise<void>;
};

const UNAUTH: GateState = { status: "unauthenticated", loginError: null, signingIn: false };

export const adminAuthStore = createStore<AdminAuthState>()((set, get) => ({
  gate: { status: "loading" },

  signIn: async (email, password, captchaToken) => {
    if (!supabase) return;
    set({ gate: { status: "unauthenticated", loginError: null, signingIn: true } });
    // Conditional options object: under exactOptionalPropertyTypes never pass
    // { options: undefined }.
    const creds = captchaToken
      ? { email, password, options: { captchaToken } }
      : { email, password };
    const { error } = await supabase.auth.signInWithPassword(creds);
    if (error) {
      set({ gate: { status: "unauthenticated", loginError: mapAuthError(error), signingIn: false } });
    }
    // success → SIGNED_IN fires → listener probes → authorized/notAuthorized
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut({ scope: "global" });
    // SIGNED_OUT fires → listener sets unauthenticated (NEVER re-anon).
  },

  refreshAndRetry: async () => {
    if (!supabase) return;
    const g = get().gate;
    if (g.status === "notAuthorized" && g.refreshing) return; // double-click guard
    set({ gate: { status: "notAuthorized", refreshing: true } });
    const { error } = await supabase.auth.refreshSession();
    // On success TOKEN_REFRESHED drives the single re-probe (which resets refreshing via
    // applyOutcome). On failure, clear the spinner so the buttons work again.
    if (error && get().gate.status === "notAuthorized") {
      set({ gate: { status: "notAuthorized", refreshing: false } });
    }
  },

  retry: async () => {
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      set({ gate: UNAUTH });
      return;
    }
    lastProbedToken = null; // force a re-probe of the same token
    await runProbe(session.access_token);
  },
}));

// --- probe + lifecycle --------------------------------------------------------

let initialized = false;
let subscription: { unsubscribe: () => void } | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let probeEpoch = 0;
let lastProbedToken: string | null = null;
let currentAbort: AbortController | null = null;

/** Boot watchdog (ms): if no session/probe ever resolves (SDK stall, hung backend),
 * leave the splash instead of spinning forever. Only acts while still "loading". */
const WATCHDOG_MS = 8000;

function clearWatchdog(): void {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

function setResolved(gate: GateState): void {
  clearWatchdog();
  adminAuthStore.setState({ gate });
}

/** Run the admin probe for the session carrying `token`. Deduped by token (a repeat
 * of the same token — INITIAL_SESSION + SIGNED_IN + cross-tab — is skipped whether the
 * first probe is in-flight or done; only a NEW token re-probes). Stale results are
 * dropped by epoch. `retry()` clears lastProbedToken to force a re-probe. */
async function runProbe(token: string): Promise<void> {
  if (token === lastProbedToken) return; // same token already probed/in-flight
  lastProbedToken = token;
  const epoch = ++probeEpoch;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;

  const outcome = await probeAdmin(ac.signal);
  if (epoch !== probeEpoch) return; // superseded by a newer probe → drop

  switch (outcome.kind) {
    case "authorized":
      setResolved({ status: "authorized", userId: outcome.userId });
      break;
    case "notAuthorized":
      setResolved({ status: "notAuthorized", refreshing: false });
      break;
    case "unauthenticated":
      setResolved(UNAUTH);
      break;
    case "serviceUnavailable":
      setResolved({ status: "serviceUnavailable", transient: outcome.transient });
      break;
    case "networkError":
      setResolved({ status: "serviceUnavailable", transient: true });
      break;
    case "authUnavailable":
      setResolved({ status: "authUnavailable" });
      break;
  }
}

function handleAuth(event: string, token: string | null): void {
  if (event === "SIGNED_OUT" || !token) {
    lastProbedToken = null;
    currentAbort?.abort();
    setResolved(UNAUTH); // NEVER signInAnonymously here
    return;
  }
  // Any session-bearing event (INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED):
  // probe. Dedup/epoch inside runProbe collapse the INITIAL_SESSION+SIGNED_IN storm.
  void runProbe(token);
}

/** Idempotent bootstrap. Call once (App mount). */
export function initAdminAuth(): void {
  if (initialized) return;
  initialized = true;

  if (!supabase) {
    adminAuthStore.setState({ gate: { status: "authUnavailable" } });
    return;
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const token = session?.access_token ?? null;
    // Defer out of the callback: the probe reads getSession/refreshSession, which
    // re-enter the GoTrue lock held during this callback.
    queueMicrotask(() => handleAuth(event, token));
  });
  subscription = data.subscription;

  watchdog = setTimeout(() => {
    watchdog = null;
    if (adminAuthStore.getState().gate.status === "loading") {
      adminAuthStore.setState({ gate: { status: "serviceUnavailable", transient: true } });
    }
  }, WATCHDOG_MS);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      subscription?.unsubscribe();
      clearWatchdog();
      currentAbort?.abort();
    });
  }
}

/** Test-only reset of module singletons (no-op in prod paths). */
export function __resetAdminAuthForTest(): void {
  initialized = false;
  subscription = null;
  clearWatchdog();
  probeEpoch = 0;
  lastProbedToken = null;
  currentAbort = null;
  adminAuthStore.setState({ gate: { status: "loading" } });
}

/** React binding. Always call with a selector to avoid needless re-renders. */
export function useAdminAuth<T>(selector: (state: AdminAuthState) => T): T {
  return useStore(adminAuthStore, selector);
}
