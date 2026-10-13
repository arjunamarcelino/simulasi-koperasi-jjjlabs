/* ------------------------------------------------------------------------- *
 * SIM-22 single-command E2E orchestrator.
 *
 * Playwright's webServer boots BEFORE globalSetup, so we can't start Supabase in
 * globalSetup and inject its env into the dev server. Instead this wrapper starts
 * local Supabase first, captures its API URL + anon key, and runs `playwright test`
 * with those (plus VITE_TRANSPORT=mock) in the environment — the dev server (webServer)
 * inherits them.
 *
 * Safety: Node does NOT run `finally` on SIGINT/SIGTERM, so teardown is also wired to
 * signal handlers. And we only stop Supabase if WE started it — never tear down a
 * teammate's long-running local stack. Uses only the public anon key; never the
 * RLS-bypassing secret key (keeping its literal name out of apps/web/** also keeps
 * the guard-secrets workflow quiet).
 * ------------------------------------------------------------------------- */

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../db");
const sb = (args, opts = {}) =>
  spawnSync("supabase", args, { cwd: DB_DIR, encoding: "utf8", ...opts });

const alreadyUp = sb(["status"]).status === 0;
let stopped = false;
const stop = () => {
  if (alreadyUp || stopped) return; // don't kill a stack we didn't start
  stopped = true;
  sb(["stop"], { stdio: "inherit" });
};
// On a signal during `supabase start`/`status` (below), the sync child hasn't been
// spawned yet, so stop here. Once `playwright test` is running under spawnSync the
// event loop is parked; the signal propagates to the child, it exits, spawnSync
// returns, and the `finally` handles teardown — so these handlers mainly cover the
// pre-Playwright window.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stop();
    process.exit(130);
  });
}

try {
  // stdio:"inherit" echoes the local status table (incl. the RLS-bypassing local key)
  // to the CI log — these are Supabase's fixed, publicly-documented demo keys for a
  // throwaway local stack, not our hosted project's secrets. (The literal key name is
  // kept out of apps/web/** so the guard-secrets workflow doesn't false-positive.)
  if (!alreadyUp) execFileSync("supabase", ["start"], { cwd: DB_DIR, stdio: "inherit" });

  const envText = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: DB_DIR,
    encoding: "utf8",
  });
  // Line-anchored (^…/m) so a future env key that contains API_URL/ANON_KEY as a
  // substring can't match ahead of the intended line.
  const pick = (key) => envText.match(new RegExp(`^${key}="?([^"\\n]+)`, "m"))?.[1];
  const apiUrl = pick("API_URL");
  const anonKey = pick("ANON_KEY");
  if (!apiUrl || !anonKey) throw new Error("Could not read API_URL / ANON_KEY from supabase status");

  const run = spawnSync("pnpm", ["exec", "playwright", "test"], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_TRANSPORT: "mock",
      VITE_SUPABASE_URL: apiUrl,
      VITE_SUPABASE_ANON_KEY: anonKey,
    },
  });
  process.exitCode = run.status ?? 1;
} finally {
  stop();
}
