import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Minimal `process` typing so we can pass cwd to loadEnv without pulling in @types/node.
declare const process: { cwd(): string };

/**
 * CSP for the production build of the ADMIN app (separate from the game). Bounds the
 * XSS surface around the Supabase refresh token in localStorage. `connect-src` is
 * pinned at build time to `'self'` + the Supabase project (https + wss) + the admin
 * API origin (`/admin/me`), so an injected script can't exfiltrate the refresh token
 * to an arbitrary host. Turnstile adds script-src + frame-src for challenges.cloudflare.com
 * ONLY (never connect-src) when a site key is set.
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
  const adminApi = originOf(env["VITE_ADMIN_API_ENDPOINT"]);
  if (adminApi) connect.push(adminApi);

  const cf = "https://challenges.cloudflare.com";
  const hasTurnstile = !!env["VITE_TURNSTILE_SITE_KEY"]?.trim();
  const script = hasTurnstile ? `'self' ${cf}` : "'self'";
  const frame = hasTurnstile ? `'self' ${cf}` : "'self'";

  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
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
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [react(), tailwindcss(), cspMeta(buildCsp(env))],
    build: { modulePreload: { polyfill: false } },
    // Admin store/libs are pure logic over a mocked Supabase + fetch — Node env, no DOM.
    test: { environment: "node" },
  };
});
