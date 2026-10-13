/* ------------------------------------------------------------------------- *
 * DEV-ONLY E2E harness (SIM-22). Inert unless BOTH `import.meta.env.DEV` is true
 * AND a `?e2e=<scenarioId>` query param is present, so it never activates in a
 * normal dev session and is dead-code-eliminated from the production build (the
 * only caller, App.tsx, guards a dynamic import on `import.meta.env.DEV`).
 *
 * It does two things:
 *   1. Opens the session overlay for the requested scenario once the anonymous
 *      Supabase session is established (auth.status === "guest"). It does NOT
 *      connect — Playwright clicks the real "Mulai Percakapan" button, which is
 *      the only connect path (SessionOverlay never auto-connects; a programmatic
 *      startScenario here would race the overlay mount effect's reset under
 *      StrictMode + vite dev).
 *   2. Installs a READ-ONLY `window.__e2e` bridge for deterministic gating.
 *      The access token is exposed only for the owner-scoped REST assertion; the
 *      confidentiality control is "absent from prod + localhost-only", not the
 *      read-only shape.
 * ------------------------------------------------------------------------- */

import { gameStore } from "../stores/game.store";
import { authStore } from "../stores/auth.store";
import { sessionStore } from "../stores/session.store";
import type { ScenarioId } from "../session/transport/contract";
import type { E2EBridge } from "./e2eHarness.types";

/** Allow-list so an arbitrary `?e2e=` value can't be widened into a ScenarioId. */
const KNOWN_SCENARIOS = ["kredit-macet"] as const;
const isScenarioId = (s: string): s is ScenarioId =>
  (KNOWN_SCENARIOS as readonly string[]).includes(s);

export function installE2EHarness(): void {
  if (!import.meta.env.DEV) return; // defence-in-depth; prod drops this branch entirely
  if (window.__e2e) return; // idempotent (StrictMode double-invokes the caller effect)

  const scenario = new URLSearchParams(window.location.search).get("e2e");
  if (!scenario || !isScenarioId(scenario)) return; // no param / malformed → stay inert

  const bridge: E2EBridge = {
    getAuth() {
      const a = authStore.getState().auth;
      return {
        status: a.status,
        isAnonymous: a.session?.user?.is_anonymous ?? null,
        accessToken: a.session?.access_token ?? null,
      };
    },
    getSessionState() {
      const s = sessionStore.getState();
      const last = s.transcript[s.transcript.length - 1];
      return {
        agentJoined: s.agentJoined,
        lastSpeaker: last?.speaker ?? null,
        lastStreaming: last?.streaming ?? false,
        ended: s.ended,
      };
    },
  };
  window.__e2e = bridge;

  // Enter only once the anonymous session is live (NOT merely `ready`, which flips
  // true in degraded/no-session mode → record_session would return {ok:false}).
  const enter = (): boolean => {
    if (authStore.getState().auth.status !== "guest") return false;
    gameStore.getState().setView("SCENARIO_SELECTION"); // renders HubPage + its overlays
    gameStore.getState().enterSessionScenario(scenario); // activeOverlay -> "SESSION"
    // Strip the param so a reload can't re-trigger (mirrors auth.store stripAuthParams).
    const url = new URL(window.location.href);
    url.searchParams.delete("e2e");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return true;
  };

  if (!enter()) {
    const off = authStore.subscribe(() => {
      if (enter()) off();
    });
  }
}
