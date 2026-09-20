import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Content-Security-Policy for the production build. Bounds the XSS surface around
 * the Supabase refresh token in localStorage: `script-src 'self'` blocks injected
 * external scripts, `object-src 'none'` + `base-uri 'self'` close common bypasses.
 * `style-src 'unsafe-inline'` is required for React/Phaser inline style attributes
 * and Google Fonts; connect stays broad (https:/wss:) because the Supabase, LiveKit
 * and backend origins are deploy-time env — tighten to explicit hosts in prod.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

/** Inject the CSP meta only into the built HTML (dev server needs inline/eval/ws). */
function cspMeta(): Plugin {
  return {
    name: "inject-csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "</title>",
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cspMeta()],
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
});
