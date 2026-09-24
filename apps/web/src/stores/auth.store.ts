import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase, type Profile } from "../lib/supabase";
import { gameStore } from "./game.store";

/**
 * Auth + identity store (SIM-3). Wraps Supabase Auth: a silent anonymous guest at
 * launch, optional Google upgrade via linkIdentity, and profile display_name.
 *
 * Writer partition (mirrors session.store's single-writer discipline), per field group:
 *   - `ready` + the session/status of `auth` are written ONLY by the onAuthStateChange
 *     listener (writeSession) — never from an imperative action tail, so `ready` can
 *     never flip true ahead of the session it describes. Do NOT add a third writer here.
 *   - `auth.profile` is co-written only by loadProfile / setDisplayName (which never
 *     touch ready/session/status), serialized by a monotonic profileEpoch.
 *
 * The store also projects profile.display_name → game.store.playerName so Phaser
 * (VillageScene/Player) keeps reading its single React↔Phaser bridge unchanged.
 */

export type LinkResult = { ok: true } | { ok: false; reason: "collision" | "error" };

/**
 * Discriminated union: a non-loading/degraded status GUARANTEES a non-null
 * session+user, so consumers never null-check user under `status === 'guest'`.
 */
export type AuthSnapshot =
  | { status: "loading"; session: null; user: null; profile: null }
  | { status: "degraded"; session: null; user: null; profile: null } // no env / auth outage — app still runs
  | { status: "guest"; session: Session; user: User; profile: Profile | null }
  | { status: "authenticated"; session: Session; user: User; profile: Profile | null };

export type AuthState = {
  ready: boolean;
  auth: AuthSnapshot;
  /** Full-page OAuth into a (possibly new) Google account — collision fallback. */
  signInWithGoogle: () => Promise<void>;
  /** Upgrade the current guest to Google (same id). Collision → LinkResult. */
  linkGoogle: () => Promise<LinkResult>;
  signOut: () => Promise<void>;
  /**
   * Write `profiles.display_name` (DB-backed, RLS owner-only). Trims + clamps to
   * MAX_NAME and no-ops on empty. Deliberately no-ops in degraded/no-session mode:
   * unlike the device-local wallet, naming REQUIRES a live session — the name is
   * server identity, so there is no local fallback (an accepted asymmetry).
   */
  setDisplayName: (name: string) => Promise<void>;
  loadProfile: (id: string) => Promise<void>;
};

const LOADING: AuthSnapshot = { status: "loading", session: null, user: null, profile: null };
const DEGRADED: AuthSnapshot = { status: "degraded", session: null, user: null, profile: null };

/** Max display-name length — the single source shared with the ProfileModal editor. */
export const MAX_NAME = 16;

// Monotonic write-generation for `profile`. setDisplayName (an explicit user write)
// bumps it; loadProfile (an async read) captures it and drops its result if a newer
// write landed during the await — so a slow profile GET can't clobber a fresh rename
// under the SAME uid (the id-guard alone doesn't cover same-id, content-changed).
let profileEpoch = 0;

/** Two literals (not one `status: 'guest'|'authenticated'` object) so each stays
 * assignable to its own union member under the discriminated union. */
function snapshotFor(session: Session, profile: Profile | null): AuthSnapshot {
  return session.user.is_anonymous
    ? { status: "guest", session, user: session.user, profile }
    : { status: "authenticated", session, user: session.user, profile };
}

export const authStore = createStore<AuthState>()(
  subscribeWithSelector((set, get) => ({
    ready: false,
    auth: LOADING,

    signInWithGoogle: async () => {
      if (!supabase) return;
      gameStore.getState().stashNavForRedirect();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
    },

    linkGoogle: async (): Promise<LinkResult> => {
      if (!supabase) return { ok: false, reason: "error" };
      gameStore.getState().stashNavForRedirect();
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (!error) return { ok: true };
      return { ok: false, reason: isCollision(error) ? "collision" : "error" };
    },

    signOut: async () => {
      if (!supabase) return;
      // The live voice room is torn down by the session controller, which OBSERVES
      // auth and stops on the resulting uid change (see session/controller.ts) — the
      // dependency arrow stays session→auth, not the reverse.
      // Global scope revokes the refresh token server-side for a signed-in member
      // (defence for a shared machine); a guest just churns to a fresh anon locally.
      const scope = get().auth.status === "authenticated" ? "global" : "local";
      await supabase.auth.signOut({ scope });
      // onAuthStateChange('SIGNED_OUT') re-anons in the listener — every tab self-heals.
    },

    setDisplayName: async (name: string) => {
      const user = get().auth.user;
      if (!supabase || !user) return;
      const clean = name.trim().slice(0, MAX_NAME);
      if (!clean) return;
      const epoch = ++profileEpoch; // this explicit write is now the newest truth
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: clean })
        .eq("id", user.id);
      if (error) return;
      set((s) => {
        if (s.auth.user?.id !== user.id) return {}; // account switched mid-await
        if (profileEpoch !== epoch) return {}; // a newer profile write superseded this one
        if (s.auth.status !== "guest" && s.auth.status !== "authenticated") return {};
        return { auth: { ...s.auth, profile: { id: user.id, display_name: clean } } };
      });
    },

    loadProfile: async (id: string) => {
      if (!supabase) return;
      const epoch = profileEpoch; // capture; drop the result if a newer write lands
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", id)
        .single();
      // STALE if a newer id (account switch) OR a newer profile write (setDisplayName) won.
      if (get().auth.user?.id !== id || profileEpoch !== epoch) return;
      set((s) => {
        if (s.auth.status !== "guest" && s.auth.status !== "authenticated") return {};
        return { auth: { ...s.auth, profile: data ?? null } };
      });
    },
  })),
);

// --- bootstrap ----------------------------------------------------------------

let initialized = false;
let reconciled = false;
let subscription: { unsubscribe: () => void } | null = null;
let mirrorUnsub: (() => void) | null = null;
let walletOwnerUnsub: (() => void) | null = null;
let readyTimer: ReturnType<typeof setTimeout> | null = null;

/** Degraded-mode fallback budget (ms), measured from each (re-)arm — see armDegrade. Kept
 * DECOUPLED from the captcha token wait: it's re-armed at sign-in START (post-token), so the
 * sign-in RTT gets a full DEGRADE_MS window instead of sharing one deadline with the ≤WAIT_MS
 * token wait (which caused a slow-network splash→degraded→guest flash). */
const DEGRADE_MS = 3000;

/** Single degrade writer, shared by every timer site: flips to DEGRADED only while auth is
 * still resolving (status "loading"), so a stale timer can't degrade a now-live session. */
function degrade(): void {
  readyTimer = null; // the timer just fired — drop the stale id
  if (authStore.getState().auth.status === "loading") {
    authStore.setState({ ready: true, auth: DEGRADED });
  }
}

/** (Re-)arm the degraded fallback DEGRADE_MS from now. Cleared on any real session
 * (writeSession). Called at boot, on SIGNED_OUT, and at sign-in start (the decouple). */
function armDegrade(): void {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = setTimeout(degrade, DEGRADE_MS);
}

/**
 * Idempotent auth bootstrap. Reconciles OFF the listener's INITIAL_SESSION event
 * (which fires AFTER detectSessionInUrl has processed a Google redirect) — never a
 * bare getSession()+signInAnonymously(), which could race the redirect and both
 * mint a spurious 3rd guest AND discard the Google login.
 */
export function initAuth(): void {
  if (initialized) return;
  initialized = true;

  gameStore.getState().restoreNavAfterRedirect();

  if (!supabase) {
    // Mock dev / no env: boot degraded so Main Menu + wallet still work. Load the
    // device-local (legacy) wallet since no owner subscription is wired below.
    authStore.setState({ ready: true, auth: DEGRADED });
    gameStore.getState().onOwnerChanged(null, null);
    return;
  }

  // Read-only projection: profile.display_name → game.store.playerName (Phaser's
  // single bridge). fireImmediately syncs the initial value at wiring time.
  mirrorUnsub = authStore.subscribe(
    (s) => s.auth.profile?.display_name ?? null,
    (displayName) => gameStore.setState({ playerName: displayName }),
    { fireImmediately: true },
  );

  // Bind the wallet to the current account. On a uid change the game store resets
  // the in-memory wallet, hydrates the new owner's wallet from the DB, and runs the
  // one-time legacy migration — so a shared device can't bleed one account's wallet
  // into another, and a guest→Google upgrade (same uid) preserves progress.
  walletOwnerUnsub = authStore.subscribe(
    (s) => s.auth.user?.id ?? null,
    (uid, prevUid) => gameStore.getState().onOwnerChanged(prevUid, uid),
    { fireImmediately: true },
  );

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // Capture the prior id BEFORE writeSession overwrites it, so the id-change
    // check below actually detects a change (the plan's post-write check couldn't).
    const prevId = authStore.getState().auth.user?.id ?? null;
    writeSession(session); // SINGLE writer of `auth` + `ready`
    stripAuthParams();

    const user = session?.user;
    if (user && user.id !== prevId) {
      // Defer the profile query out of the callback (no await inside
      // onAuthStateChange — Supabase serializes calls made synchronously here).
      queueMicrotask(() => void authStore.getState().loadProfile(user.id));
    }

    // Re-anon is deferred off the callback (like loadProfile): signInAnonymously
    // re-enters the GoTrue lock held during this callback, so queue it for the next
    // microtask instead of calling it inline.
    if (!reconciled && event === "INITIAL_SESSION") {
      reconciled = true;
      if (!session) queueMicrotask(() => void anonSignIn());
    }
    if (event === "SIGNED_OUT") {
      reconciled = true;
      armDegrade(); // a captcha'd re-anon can fail — degrade instead of hanging in LOADING
      queueMicrotask(() => void anonSignIn());
    }
  });
  subscription = data.subscription;

  // Safety net: if INITIAL_SESSION never arrives (SDK stall), still release the
  // splash into degraded mode rather than hang forever. Re-armed at sign-in start.
  armDegrade();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      subscription?.unsubscribe();
      mirrorUnsub?.();
      walletOwnerUnsub?.();
      if (readyTimer) clearTimeout(readyTimer);
    });
  }
}

function writeSession(session: Session | null): void {
  // A real session releases the boot gate and cancels the degraded fallback timer.
  // A null session (first-visit-pre-anon, or sign-out) must NOT flip `ready`: on a
  // first visit the re-anon's SIGNED_IN is what releases the gate, so the app never
  // renders under a released gate with a null user. The 3s readyTimer stays armed as
  // the sole fallback (degrades if no session ever arrives — e.g. re-anon fails).
  if (session && readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  authStore.setState((s) => ({
    ready: session ? true : s.ready,
    // Carry the profile only when the uid is unchanged; on an id change (account
    // switch) start null so the new user never briefly shows the prior name — the
    // deferred loadProfile then populates it. LOADING is the transient re-anon gap.
    auth: session
      ? snapshotFor(session, session.user.id === s.auth.user?.id ? s.auth.profile : null)
      : LOADING,
  }));
}

// --- CAPTCHA seam -------------------------------------------------------------

/** Async Turnstile token source (lib/captcha.ts). Awaited before each anon sign-in. */
export type CaptchaTokenProvider = () => Promise<string | undefined>;
let captchaTokenProvider: CaptchaTokenProvider | null = null;

/**
 * Wire a Turnstile token source. SIM-40 provisions CAPTCHA on the anon sign-in
 * endpoint; when it's enabled, the FE must supply a token or the launch bootstrap
 * breaks. Until a provider is set (or it yields undefined), anon sign-in runs
 * tokenless — the app still boots.
 */
export function setCaptchaTokenProvider(provider: CaptchaTokenProvider): void {
  captchaTokenProvider = provider;
}

function anonSignIn(): Promise<unknown> {
  const run = async () => {
    // Await the captcha token (the provider owns a bounded wait). Only the tab that
    // actually signs in consumes a single-use token — see the Web Lock below.
    const token = await captchaTokenProvider?.();
    // Decouple: the token wait may have eaten most of the boot budget — re-arm the degrade
    // deadline so the sign-in RTT gets its own full DEGRADE_MS window (no early flicker).
    armDegrade();
    return supabase!.auth.signInAnonymously(token ? { options: { captchaToken: token } } : {});
  };
  // Elect a single tab to perform the re-anon: N open tabs all receive SIGNED_OUT
  // (via the storage event) and would each mint an anonymous user AND trigger a
  // wallet reset. Hold a cross-tab Web Lock so only the winner signs in; the others
  // (ifAvailable → null lock) skip and adopt the winning session via the storage
  // event, so their syncWalletOwner no-ops (same uid). No lock API (node/tests) →
  // sign in directly.
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("koperasi.reanon", { ifAvailable: true }, (lock) =>
      lock ? run() : Promise.resolve(),
    );
  }
  return run();
}

/** Strip the OAuth `?code`/`?error` params so a reload can't reprocess them. */
function stripAuthParams(): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ["code", "error", "error_description", "state"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // URL/history unavailable — harmless to skip
  }
}

function isCollision(error: AuthError): boolean {
  return error.code === "identity_already_exists" || /already.*(exist|link)/i.test(error.message);
}

/** React binding. Always call with a selector to avoid needless re-renders. */
export function useAuth<T>(selector: (state: AuthState) => T): T {
  return useStore(authStore, selector);
}
