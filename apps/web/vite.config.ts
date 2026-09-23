import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Minimal `process` typing so we can pass cwd to loadEnv without pulling in @types/node.
declare const process: { cwd(): string };

/**
 * Content-Security-Policy for the production build. Bounds the XSS surface around
 * the Supabase refresh token in localStorage: `script-src 'self'` blocks injected
 * external scripts, `object-src 'none'` + `base-uri 'self'` close common bypasses.
 * `style-src 'unsafe-inline'` is required for React/Phaser inline style attributes
 * and Google Fonts.
 *
 * `connect-src` is pinned at build time to the known origins — `'self'` + the
 * Supabase project (https + wss realtime) + the token-endpoint origin — so an
 * injected script can't POST the refresh token to an arbitrary https host. `wss:`
 * stays broad because the LiveKit host is learned at runtime from the /token
 * response (not known at build); that residual wss channel is the accepted
 * trade-off for not threading a VITE_LIVEKIT_URL.
 */
function originOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function buildCsp(env: Record<string, string>): string {
  const connect = ["'self'"];
  const supabase = originOf(env["VITE_SUPABASE_URL"]);
  if (supabase) {
    connect.push(supabase, `wss://${new URL(supabase).host}`); // REST/auth + realtime
  }
  const token = originOf(env["VITE_TOKEN_ENDPOINT"]);
  if (token) connect.push(token);
  connect.push("wss:"); // LiveKit host is runtime-dynamic (from /token) — keep wss broad

  // Turnstile (SIM-41): only when a site key is set, and only script-src + frame-src.
  // NOT connect-src — the challenge runs in the challenges.cloudflare.com iframe, whose
  // requests are governed by ITS csp, so widening our connect-src would only enlarge the
  // refresh-token exfil surface this policy exists to bound.
  const cf = "https://challenges.cloudflare.com";
  const hasTurnstile = !!env["VITE_TURNSTILE_SITE_KEY"]?.trim();
  const script = hasTurnstile ? `'self' ${cf}` : "'self'";
  // frame-src is new here; baseline 'self' preserves today's same-origin-frame fallback.
  const frame = hasTurnstile ? `'self' ${cf}` : "'self'";

  return [
    "default-src 'self'",
    `script-src ${script}`,
    // 'unsafe-inline' also covers Turnstile's injected widget styles (keep if tightening later).
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${frame}`,
    "worker-src 'self' blob:",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Inject the CSP meta only into the built HTML (dev server needs inline/eval/ws). */
function cspMeta(csp: string): Plugin {
  return {
    name: "inject-csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "</title>",
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Read VITE_* (Supabase URL, token endpoint) to pin connect-src for this build.
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [react(), tailwindcss(), cspMeta(buildCsp(env))],
    // Drop Vite's inline module-preload polyfill so `script-src 'self'` needs no
    // nonce/unsafe-inline (modern ES2022 target supports modulepreload natively).
    build: {
      modulePreload: { polyfill: false },
    },
    // Unit tests run in Node (the auth store is pure logic over a mocked Supabase
    // port). The localStorage helpers guard `window` access, so game.store still
    // imports cleanly here. Explicit `vitest` imports in tests (no globals).
    test: {
      environment: "node",
    },
  };
});
