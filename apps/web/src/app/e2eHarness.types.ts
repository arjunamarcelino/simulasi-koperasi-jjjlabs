/* ------------------------------------------------------------------------- *
 * E2E test bridge contract (SIM-22). Types ONLY — no value imports, no
 * `import.meta`, so the Playwright e2e tsconfig can pull this in (for the
 * `window.__e2e` global) without needing vite/client types. The implementation
 * lives in e2eHarness.ts and is DEV-only (stripped from the production build).
 * ------------------------------------------------------------------------- */

import type { Speaker, SessionEnded } from "../session/transport/contract";

/** Read-only inspection surface Playwright polls for deterministic gating. */
export interface E2EBridge {
  getAuth(): {
    // Deliberately `string`, not the store's AuthSnapshot["status"] union: this
    // types-only module must stay free of value-module imports (auth.store pulls in
    // import.meta.hot, which the e2e tsconfig can't resolve). The spec only compares
    // against "guest", so the loose type is sufficient here.
    status: string;
    isAnonymous: boolean | null;
    accessToken: string | null;
  };
  getSessionState(): {
    agentJoined: boolean;
    lastSpeaker: Speaker | null;
    lastStreaming: boolean;
    ended: SessionEnded | null;
  };
}

declare global {
  interface Window {
    /** Present only under `vite dev` + `?e2e=` (see e2eHarness.ts). */
    __e2e?: E2EBridge;
  }
}
