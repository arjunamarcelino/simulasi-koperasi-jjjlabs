/**
 * Cloudflare Turnstile (Invisible) integration for the silent anonymous sign-in (SIM-41).
 *
 * A module singleton: injects `api.js` once, renders ONE invisible widget into a hidden
 * container, and exposes an async {@link getCaptchaToken} the auth store awaits before
 * `signInAnonymously`. The Cloudflare widget must be type "Invisible" — it never shows UI.
 *
 * Token discipline: Turnstile tokens are SINGLE-USE (~300s TTL). `getCaptchaToken` hands a
 * fresh token out at most once, then `reset()`s to pre-warm the next — so a re-anon within
 * the TTL never replays a consumed token. The success `callback` gives a token to exactly
 * one awaiter OR caches it, never both, so a consumed token is never re-served.
 *
 * Degraded by design: no site key → nothing loads. Script/challenge failure → the provider
 * yields `undefined` (tokenless) and the auth store's degrade fallback takes over; a transient
 * error re-arms the widget (`scheduleRearm`) instead of wedging tokenless for the session.
 */

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const WAIT_MS = 2000; // bounded wait for the FIRST token (< the store's 3s degrade timer → no flicker)
const REARM_MS = 3000; // backoff before re-arming the widget after an error/timeout

interface TurnstileRenderOptions {
  sitekey: string;
  execution?: "render" | "execute";
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (code?: string) => void;
  "timeout-callback"?: () => void;
}
interface TurnstileApi {
  render: (el: HTMLElement | string, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let started = false;
let widgetId: string | undefined;
let container: HTMLDivElement | undefined;
let currentToken: string | undefined; // a FRESH, unconsumed token (or undefined)
let waiters: Array<(token: string | undefined) => void> = [];
let rearmTimer: ReturnType<typeof setTimeout> | undefined;

/** Fan `undefined` out to every pending waiter (failure path). */
function failAllWaiters(): void {
  waiters.splice(0).forEach((w) => w(undefined));
}

function requestFresh(): void {
  if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
}

/** Recover from a transient error/timeout: re-arm the widget after a small backoff. */
function scheduleRearm(): void {
  clearTimeout(rearmTimer);
  rearmTimer = setTimeout(requestFresh, REARM_MS);
}

/** Idempotent. Injects `api.js` once and renders one invisible widget into a hidden div. */
export function startTurnstile(siteKey: string): void {
  if (started || typeof document === "undefined") return;
  started = true;

  container = document.createElement("div");
  container.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;";
  document.body.appendChild(container);

  const render = () => {
    widgetId = window.turnstile?.render(container as HTMLElement, {
      sitekey: siteKey,
      execution: "render", // fetch a token as soon as it renders
      appearance: "interaction-only", // no visible UI (invisible widget)
      // Single-use handoff: give the token to exactly ONE awaiter (consumed live, NOT
      // cached), else cache it for the next call. Never both → no burned-token re-serve.
      callback: (token) => {
        const w = waiters.shift();
        if (w) w(token);
        else currentToken = token;
      },
      "expired-callback": () => {
        currentToken = undefined;
        requestFresh();
      }, // TTL (~300s) lapsed with no consumption
      "error-callback": () => {
        currentToken = undefined;
        failAllWaiters();
        scheduleRearm();
      },
      "timeout-callback": () => {
        currentToken = undefined;
        failAllWaiters();
        scheduleRearm();
      },
    });
  };

  if (window.turnstile) render();
  else {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = render;
    script.onerror = failAllWaiters; // blocked/offline → provider yields undefined
    document.head.appendChild(script);
  }
}

/**
 * Async provider handed to the auth store. Returns a FRESH single-use token (then rotates
 * one in the background), or `undefined` after {@link WAIT_MS} / on error. Only a caller that
 * actually consumes a token triggers a reset.
 */
export async function getCaptchaToken(): Promise<string | undefined> {
  if (!started) return undefined;
  const cached = currentToken;
  currentToken = undefined; // hand out at most once
  const token = cached ?? (await waitForNext(WAIT_MS));
  if (token) requestFresh(); // pre-warm the next single-use token for the next sign-in
  return token;
}

function waitForNext(ms: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const w = (token: string | undefined) => {
      clearTimeout(timer);
      resolve(token);
    };
    const timer = setTimeout(() => {
      waiters = waiters.filter((x) => x !== w);
      resolve(undefined);
    }, ms);
    waiters.push(w);
  });
}

// Tear the widget down on HMR so dev doesn't accumulate stacked iframes/timers (mirrors
// auth.store's dispose). Also fails outstanding waiters so no promise hangs into a dead module.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    container?.remove();
    failAllWaiters();
    clearTimeout(rearmTimer);
    started = false;
    widgetId = undefined;
    container = undefined;
    currentToken = undefined;
  });
}
