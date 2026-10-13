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
    command: `pnpm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
