import { defineConfig, devices } from "@playwright/test";

/**
 * SIM-22 E2E smoke. Single Chromium project. The dev server runs on a DEDICATED
 * port (not 5173) with reuseExistingServer:false, so a stray interactive `pnpm dev`
 * — which would lack the injected VITE_TRANSPORT=mock + local Supabase env — can
 * never be silently reused. Supabase itself is started by e2e/run-e2e.mjs BEFORE
 * Playwright (webServer boots before globalSetup, so globalSetup can't own it).
 */
const PORT = 5273;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Sequential polls budget ~90s total (auth + connect + greeting + send + reply +
  // ending + persist). Raise the per-test cap above the 30s default so a slow runner
  // (SwiftShader WebGL boot, Supabase warm-up, CI contention) can't be killed mid-flow
  // even when no individual step exceeds its budget.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0, // safe: each retry = fresh context → fresh anon uid; RLS hides prior rows
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Headless Chromium has no GPU; HubPage boots Phaser/WebGL under the overlay.
        launchOptions: {
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  webServer: {
    // Invoke vite directly (not `pnpm run dev --`) — pnpm leaks the `--` through to
    // the script, so `vite -- --port` is parsed as positional and ignored (binds 5173).
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
