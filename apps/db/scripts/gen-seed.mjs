#!/usr/bin/env node
/**
 * Generate `supabase/seed.sql` from the shared catalog JSON in `catalog/*.json`.
 *
 * The JSON files are the single source of truth for catalog content; the FE
 * content arrays (apps/web/src/content/*) and this seed both derive from them,
 * so the two can never silently drift.
 *
 * Usage:
 *   node scripts/gen-seed.mjs           # write supabase/seed.sql
 *   node scripts/gen-seed.mjs --check   # exit 1 if seed.sql is out of date (CI parity guard)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const seedPath = join(root, "supabase", "seed.sql");

const read = (name) => JSON.parse(readFileSync(join(root, "catalog", name), "utf8"));

/** SQL-quote a string, or emit NULL. */
const s = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
/** SQL integer, or NULL. */
const n = (v) => (v === null || v === undefined ? "NULL" : String(v));
/** jsonb literal from a JS value, or NULL. */
const j = (v) => (v === null || v === undefined ? "NULL" : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`);

function block(title, table, cols, rows, rowToVals, conflictUpdate) {
  const lines = [];
  lines.push(`-- ${title}`);
  lines.push(`insert into public.${table} (${cols.join(", ")}) values`);
  const values = rows.map((r) => `  (${rowToVals(r).join(", ")})`);
  lines.push(values.join(",\n"));
  lines.push(`on conflict (code) do update set`);
  lines.push(conflictUpdate.map((c) => `  ${c} = excluded.${c}`).join(",\n") + ";");
  return lines.join("\n");
}

const scenarios = read("scenarios.json");
const missions = read("missions.json");
const vouchers = read("vouchers.json");
const badges = read("badges.json");

const parts = [
  "-- GENERATED FILE — do not edit by hand.",
  "-- Source: apps/db/catalog/*.json  •  Regenerate: pnpm --filter @simkop/db gen:seed",
  "-- Catalog rows mirror apps/web/src/content/* exactly (parity enforced in CI).",
  "",
  block(
    "Scenarios (4)",
    "scenario_definition",
    ["code", "title", "difficulty", "status", "sort_order"],
    scenarios,
    (r) => [s(r.code), s(r.title), s(r.difficulty), s(r.status), n(r.sort_order)],
    ["title", "difficulty", "status", "sort_order"],
  ),
  "",
  block(
    "Missions (7) — redeem_code is a server-side secret (reallife only)",
    "mission_definition",
    ["code", "kind", "title", "description", "reward_xp", "reward_point", "redeem_code", "sort_order"],
    missions,
    (r) => [s(r.code), s(r.kind), s(r.title), s(r.description), n(r.reward_xp), n(r.reward_point), s(r.redeem_code), n(r.sort_order)],
    ["kind", "title", "description", "reward_xp", "reward_point", "redeem_code", "sort_order"],
  ),
  "",
  block(
    "Vouchers (5)",
    "voucher_definition",
    ["code", "name", "cost", "description", "sort_order"],
    vouchers,
    (r) => [s(r.code), s(r.name), n(r.cost), s(r.description), n(r.sort_order)],
    ["name", "cost", "description", "sort_order"],
  ),
  "",
  block(
    "Badges (9) — criteria mirrors BadgeCriteria; null = teaser (locked until its signal exists)",
    "badge_definition",
    ["code", "title", "requirement", "icon", "criteria", "sort_order"],
    badges,
    (r) => [s(r.code), s(r.title), s(r.requirement), s(r.icon), j(r.criteria), n(r.sort_order)],
    ["title", "requirement", "icon", "criteria", "sort_order"],
  ),
  "",
];

const out = parts.join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(seedPath, "utf8");
  } catch {
    console.error("seed.sql missing — run `pnpm --filter @simkop/db gen:seed`");
    process.exit(1);
  }
  if (current !== out) {
    console.error("seed.sql is out of date with catalog/*.json — run `pnpm --filter @simkop/db gen:seed`");
    process.exit(1);
  }
  console.log("seed.sql is in sync with catalog/*.json ✓");
} else {
  writeFileSync(seedPath, out);
  console.log(`wrote ${seedPath}`);
}
