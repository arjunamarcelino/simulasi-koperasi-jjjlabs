import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { useStore } from "zustand";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase, type Profile } from "../lib/supabase";
import { gameStore, type View } from "./game.store";

/**
 * Auth + identity store (SIM-3). Wraps Supabase Auth: a silent anonymous guest at
 * launch, optional Google upgrade via linkIdentity, and profile display_name.
 *
 * Writer partition (mirrors session.store's single-writer discipline):
 *   - `ready` + `auth` are written ONLY by the onAuthStateChange listener
 *     (writeSession) — never from an imperative action tail, so `ready` can never
 *     flip true ahead of the session it describes.
 *   - `profile` is written only by loadProfile / setDisplayName.
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
  setDisplayName: (name: string) => Promise<void>;
  loadProfile: (id: string) => Promise<void>;
};

const LOADING: AuthSnapshot = { status: "loading", session: null, user: null, profile: null };
const DEGRADED: AuthSnapshot = { status: "degraded", session: null, user: null, profile: null };

const MAX_NAME = 16;

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
      stashViewState();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
    },

    linkGoogle: async (): Promise<LinkResult> => {
      if (!supabase) return { ok: false, reason: "error" };
      stashViewState();
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (!error) return { ok: true };
      return { ok: false, reason: isCollision(error) ? "collision" : "error" };
    },

    signOut: async () => {
      if (!supabase) return;
      // Tear down any live voice session on the OLD identity FIRST, so the LiveKit
      // room isn't stranded. Dynamically imported to keep livekit-client out of the
      // auth-store module graph (and its unit tests).
      try {
        const { sessionController } = await import("../session/controller");
        sessionController.stop();
      } catch {
        // controller unavailable — proceed with sign-out anyway
      }
      await supabase.auth.signOut({ scope: "local" });
      // onAuthStateChange('SIGNED_OUT') re-anons in the listener — every tab self-heals.
    },

    setDisplayName: async (name: string) => {
      const user = get().auth.user;
      if (!supabase || !user) return;
      const clean = name.trim().slice(0, MAX_NAME);
      if (!clean) return;
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: clean })
        .eq("id", user.id);
      if (error) return;
      set((s) => {
        if (s.auth.status !== "guest" && s.auth.status !== "authenticated") return {};
        return { auth: { ...s.auth, profile: { id: user.id, display_name: clean } } };
      });
    },

    loadProfile: async (id: string) => {
      if (!supabase) return;
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", id)
        .single();
      if (get().auth.user?.id !== id) return; // STALE — a newer auth won the race
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

/**
 * Idempotent auth bootstrap. Reconciles OFF the listener's INITIAL_SESSION event
 * (which fires AFTER detectSessionInUrl has processed a Google redirect) — never a
 * bare getSession()+signInAnonymously(), which could race the redirect and both
 * mint a spurious 3rd guest AND discard the Google login.
 */
export function initAuth(): void {
  if (initialized) return;
  initialized = true;

  restoreViewState();

  if (!supabase) {
    // Mock dev / no env: boot degraded so Main Menu + wallet still work.
    authStore.setState({ ready: true, auth: DEGRADED });
    return;
  }

  // Read-only projection: profile.display_name → game.store.playerName (Phaser's
  // single bridge). fireImmediately syncs the initial value at wiring time.
  mirrorUnsub = authStore.subscribe(
    (s) => s.auth.profile?.display_name ?? null,
    (displayName) => gameStore.setState({ playerName: displayName }),
    { fireImmediately: true },
  );

  // Bind the device-local wallet to the current account: on a real account switch
  // (different uid) the wallet resets, bounding cross-account bleed on shared
  // devices. A guest→Google upgrade keeps the same uid, so progress is preserved.
  walletOwnerUnsub = authStore.subscribe(
    (s) => s.auth.user?.id ?? null,
    (uid) => {
      if (uid) gameStore.getState().syncWalletOwner(uid);
    },
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

    if (!reconciled && event === "INITIAL_SESSION") {
      reconciled = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      if (!session) void anonSignIn();
    }
    if (event === "SIGNED_OUT") {
      reconciled = true;
      void anonSignIn();
    }
  });
  subscription = data.subscription;

  // Safety net: if INITIAL_SESSION never arrives (SDK stall), still release the
  // splash into degraded mode rather than hang forever.
  readyTimer = setTimeout(() => {
    if (!authStore.getState().ready) authStore.setState({ ready: true, auth: DEGRADED });
  }, 3000);

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
  authStore.setState((s) => ({
    ready: true, // released WITH the event, never ahead of the session
    auth: session ? snapshotFor(session, s.auth.profile) : LOADING, // transient; re-anon incoming
  }));
}

// --- CAPTCHA seam -------------------------------------------------------------

let captchaTokenProvider: (() => string | undefined) | null = null;

/**
 * Wire a Turnstile token source. SIM-1 provisions CAPTCHA on the anon sign-in
 * endpoint; when it's enabled, the FE must supply a token or the launch bootstrap
 * breaks. Until then anon sign-in runs tokenless (CAPTCHA is off on the project).
 */
export function setCaptchaTokenProvider(provider: () => string | undefined): void {
  captchaTokenProvider = provider;
}

function anonSignIn(): Promise<unknown> {
  const token = captchaTokenProvider?.();
  return supabase!.auth.signInAnonymously(
    token ? { options: { captchaToken: token } } : {},
  );
}

// --- OAuth redirect view state ------------------------------------------------

const VIEW_STASH_KEY = "koperasi.auth.viewStash";
const VALID_VIEWS: readonly View[] = [
  "MAIN_MENU",
  "LOADING",
  "SCENARIO_SELECTION",
  "GAME",
  "EVALUATION",
];

/** Stash the current view before a full-page OAuth redirect (avoid teleport-to-menu). */
function stashViewState(): void {
  try {
    const { currentView, selectedScenarioId } = gameStore.getState();
    sessionStorage.setItem(VIEW_STASH_KEY, JSON.stringify({ currentView, selectedScenarioId }));
  } catch {
    // sessionStorage unavailable — skip (the redirect still works, just returns to menu)
  }
}

/** Restore (once) the view stashed before an OAuth redirect. */
function restoreViewState(): void {
  try {
    const raw = sessionStorage.getItem(VIEW_STASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(VIEW_STASH_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const rec = parsed as Record<string, unknown>;
    const view = rec["currentView"];
    if (typeof view === "string" && (VALID_VIEWS as readonly string[]).includes(view)) {
      const scenarioId =
        typeof rec["selectedScenarioId"] === "string" ? rec["selectedScenarioId"] : null;
      gameStore.setState({ currentView: view as View, selectedScenarioId: scenarioId });
    }
  } catch {
    // malformed stash — ignore, land on the default view
  }
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
