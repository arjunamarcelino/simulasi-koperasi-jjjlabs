#!/usr/bin/env node
/**
 * Generate `supabase/seed.sql` from the shared catalog in `@simkop/catalog`.
 *
 * `@simkop/catalog` is the single source of truth: apps/web imports the same data
 * for the UI, and this script maps it to DB columns for the seed — so the game and
 * the database cannot silently drift. `sort_order` is derived from array position.
 *
 * Usage:
 *   node scripts/gen-seed.mjs           # write supabase/seed.sql
 *   node scripts/gen-seed.mjs --check   # exit 1 if seed.sql is out of date (CI guard)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import scenarios from "@simkop/catalog/data/scenarios.json" with { type: "json" };
import missions from "@simkop/catalog/data/missions.json" with { type: "json" };
import vouchers from "@simkop/catalog/data/vouchers.json" with { type: "json" };
import badges from "@simkop/catalog/data/badges.json" with { type: "json" };
import quiz from "@simkop/catalog/data/quiz.json" with { type: "json" };

// Reallife unlock codes are server-only: they live here, NOT in the client-bundled catalog
// (@simkop/catalog ships to apps/web). We merge them into the seed by mission id below.
import codes from "../seed-codes.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, "..", "supabase", "seed.sql");
const codesPath = join(here, "..", "seed-codes.json");

/** SQL-quote a string, or emit NULL. */
const s = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
/** SQL integer, or NULL. */
const n = (v) => (v === null || v === undefined ? "NULL" : String(v));
/** jsonb literal from a JS value, or NULL. */
const j = (v) => (v === null || v === undefined ? "NULL" : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`);

function block(title, table, cols, rows, rowToVals, conflictUpdate) {
  const values = rows.map((r, i) => `  (${rowToVals(r, i + 1).join(", ")})`);
  return [
    `-- ${title}`,
    `insert into public.${table} (${cols.join(", ")}) values`,
    values.join(",\n"),
    `on conflict (code) do update set`,
    conflictUpdate.map((c) => `  ${c} = excluded.${c}`).join(",\n") + ";",
  ].join("\n");
}

// Validate the mission ⇄ code join bidirectionally so a missing, orphan, stale, mis-keyed,
// or duplicated code fails the build instead of silently seeding a NULL or wrong redeem_code.
// (A NULL redeem_code on a reallife row is also rejected by the DB CHECK constraint, but a
// clear build-time error beats a load-time 23514.)
const reallifeIds = missions.filter((m) => m.kind === "reallife").map((m) => m.id);
const gameIds = new Set(missions.filter((m) => m.kind !== "reallife").map((m) => m.id));
const missionIds = new Set(missions.map((m) => m.id));
for (const id of reallifeIds) {
  if (!codes[id] || !String(codes[id]).trim()) {
    throw new Error(`gen-seed: reallife mission "${id}" has no code in seed-codes.json`);
  }
}
for (const k of Object.keys(codes)) {
  if (!missionIds.has(k)) throw new Error(`gen-seed: seed-codes.json has a code for unknown/stale mission id "${k}"`);
  if (gameIds.has(k)) throw new Error(`gen-seed: seed-codes.json assigns a code to game mission "${k}" (reallife only)`);
}
if (Object.keys(codes).length !== reallifeIds.length) {
  throw new Error(
    `gen-seed: seed-codes.json has ${Object.keys(codes).length} entries, expected ${reallifeIds.length} (one per reallife mission)`,
  );
}
// import() silently keeps only the last value for a duplicated JSON key — detect from raw text.
{
  const seen = new Set();
  for (const [, k] of readFileSync(codesPath, "utf8").matchAll(/"([^"]+)"\s*:/g)) {
    if (seen.has(k)) throw new Error(`gen-seed: duplicate key "${k}" in seed-codes.json`);
    seen.add(k);
  }
}

const parts = [
  "-- GENERATED FILE — do not edit by hand.",
  "-- Source: @simkop/catalog (packages/catalog)  •  Regenerate: pnpm --filter @simkop/db gen:seed",
  "-- apps/web imports the same catalog, so seed and UI cannot drift (parity checked in CI).",
  "",
  block(
    "Scenarios (4)",
    "scenario_definition",
    ["code", "title", "difficulty", "status", "sort_order"],
    scenarios,
    (r, i) => [s(r.id), s(r.title), s(r.difficulty), s(r.status), n(i)],
    ["title", "difficulty", "status", "sort_order"],
  ),
  "",
  block(
    "Missions (7) — redeem_code is a soft KDMP gate code (reallife only), not a cryptographic secret",
    "mission_definition",
    ["code", "kind", "title", "description", "reward_xp", "reward_point", "redeem_code", "sort_order"],
    missions,
    (r, i) => [s(r.id), s(r.kind), s(r.title), s(r.description), n(r.reward.xp), n(r.reward.point), s(r.kind === "reallife" ? codes[r.id] : null), n(i)],
    ["kind", "title", "description", "reward_xp", "reward_point", "redeem_code", "sort_order"],
  ),
  "",
  block(
    "Vouchers (5)",
    "voucher_definition",
    ["code", "name", "cost", "description", "sort_order"],
    vouchers,
    (r, i) => [s(r.id), s(r.name), n(r.cost), s(r.description), n(i)],
    ["name", "cost", "description", "sort_order"],
  ),
  "",
  block(
    "Badges (9) — criteria mirrors BadgeCriteria; null = teaser (locked until its signal exists)",
    "badge_definition",
    ["code", "title", "requirement", "icon", "criteria", "sort_order"],
    badges,
    (r, i) => [s(r.id), s(r.title), s(r.requirement), s(r.icon), j(r.criteria), n(i)],
    ["title", "requirement", "icon", "criteria", "sort_order"],
  ),
  "",
  block(
    "Quiz (20) — correct_index is the answer key; base table is not client-readable (quiz_catalog omits it)",
    "quiz_definition",
    ["code", "prompt", "options", "correct_index", "explanation", "sort_order"],
    quiz,
    (r, i) => [s(r.id), s(r.prompt), j(r.options), n(r.correctIndex), s(r.explanation ?? null), n(i)],
    ["prompt", "options", "correct_index", "explanation", "sort_order"],
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
    console.error("seed.sql is out of date with @simkop/catalog — run `pnpm --filter @simkop/db gen:seed`");
    process.exit(1);
  }
  console.log("seed.sql is in sync with @simkop/catalog ✓");
} else {
  writeFileSync(seedPath, out);
  console.log(`wrote ${seedPath}`);
}
