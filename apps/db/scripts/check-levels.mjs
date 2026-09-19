#!/usr/bin/env node
/**
 * Pin the DB's `level_from_xp()` thresholds to the shared `@simkop/catalog`
 * `levels.json` (which the FE ProfileModal also consumes). `level_from_xp` must be
 * IMMUTABLE, so it hardcodes the thresholds rather than reading a table — this check
 * is what keeps that hardcoded copy from drifting from the single source of truth.
 *
 * Usage: node scripts/check-levels.mjs   (exit 1 on mismatch)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import levels from "@simkop/catalog/data/levels.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(here, "..", "supabase", "migrations", "20260919090000_foundation.sql"),
  "utf8",
);

// The first tier (minXp 0) is the CASE `else 1`; tiers 2..n become
// `when p_xp >= minXp then level` and the CASE lists them highest-first.
const expected = levels
  .map((t, i) => ({ minXp: t.minXp, level: i + 1 }))
  .filter((t) => t.level > 1)
  .sort((a, b) => b.minXp - a.minXp);

const parsed = [...sql.matchAll(/when\s+p_xp\s*>=\s*(\d+)\s+then\s+(\d+)/gi)].map((m) => ({
  minXp: Number(m[1]),
  level: Number(m[2]),
}));

const norm = (a) => JSON.stringify(a.map((t) => [t.minXp, t.level]));

if (!(levels[0] && levels[0].minXp === 0)) {
  console.error("levels.json first tier must start at minXp 0 (the CASE `else 1`).");
  process.exit(1);
}
if (norm(parsed) !== norm(expected)) {
  console.error("level_from_xp() thresholds are out of sync with @simkop/catalog levels.json");
  console.error("  migration:", norm(parsed));
  console.error("  catalog:  ", norm(expected));
  process.exit(1);
}
console.log("level_from_xp() matches @simkop/catalog levels.json ✓");
