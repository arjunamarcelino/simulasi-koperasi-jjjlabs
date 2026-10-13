import { describe, it, expect } from "vitest";
// Vite `?raw` inlines the backend file as a string at transform time — no node:fs,
// no @types/node (the repo deliberately avoids it; see vite.config.ts). A moved or
// renamed scenarios.py makes this import fail to resolve → a loud build-time failure.
// NOTE: this couples the web test suite to apps/backend being present in the checkout;
// a FE-only build context would fail this file loudly (acceptable — not silent).
import backendSource from "../../../../apps/backend/voice_worker/scenarios.py?raw";
import { SCENARIOS as FE_SCENARIOS } from "./scenario.config";
import { SCENARIOS as CATALOG_SCENARIOS } from "@simkop/catalog";
import { SCORE_KEY_LABELS } from "../components/session/resultLabels";

/**
 * Extracts the backend's scenario ids by matching the `scenario_id="..."` assignment
 * literals. Deliberately ignores the field declaration (`scenario_id: str`), the
 * registry dict keys (`TUTORIAL.scenario_id:`), and the `get_scenario` parameter —
 * none of those are `scenario_id = "<literal>"`.
 */
function parseBackendScenarioIds(src: string): string[] {
  // \b anchors the left edge so a longer identifier (e.g. default_scenario_id = "...")
  // can't masquerade as a match. The `=` (not `:`) still excludes the `scenario_id: str`
  // field decl and the `.scenario_id:` registry keys.
  return [...src.matchAll(/\bscenario_id\s*=\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((id): id is string => id !== undefined);
}

/**
 * Extracts the quoted keys from every `score_keys=(...)` tuple in the backend
 * (e.g. `score_keys=("member_centric", "compliance", "soft_skills")`) — the 0–100
 * scoring dimensions the auditor emits. Each must have an FE label or the result
 * UI renders the bare key via the prettify fallback.
 */
function parseBackendScoreKeys(src: string): string[] {
  const keys: string[] = [];
  for (const tuple of src.matchAll(/\bscore_keys\s*=\s*\(([^)]*)\)/g)) {
    const body = tuple[1] ?? "";
    for (const q of body.matchAll(/["']([^"']+)["']/g)) {
      if (q[1] !== undefined) keys.push(q[1]);
    }
  }
  return keys;
}

describe("scenario.config id integrity", () => {
  const feIds = FE_SCENARIOS.map((s) => s.id);
  const catalogIds = CATALOG_SCENARIOS.map((s) => s.id);

  it("FE scenario ids are unique", () => {
    expect(new Set(feIds).size).toBe(feIds.length);
  });

  it("FE config ids === catalog ids (set equality)", () => {
    expect(new Set(feIds)).toEqual(new Set(catalogIds));
  });
});

describe("scenario.config ↔ backend parity", () => {
  const beIds = parseBackendScenarioIds(backendSource);
  const availableFeIds = FE_SCENARIOS.filter((s) => s.status === "AVAILABLE").map((s) => s.id);

  it("fail-loud guard: parse found exactly 4 backend ids (no dups)", () => {
    // Guards against a reformatted scenarios.py passing green on an empty/partial set.
    // Intentionally hardcoded: bump this to match when a scenario is added/removed.
    expect(beIds).toHaveLength(4);
    expect(new Set(beIds).size).toBe(beIds.length);
  });

  it("every AVAILABLE FE scenario has a backend worker", () => {
    const beSet = new Set(beIds);
    expect(availableFeIds.filter((id) => !beSet.has(id))).toEqual([]);
  });

  it("every backend scenario exists in FE config", () => {
    const feSet = new Set(FE_SCENARIOS.map((s) => s.id));
    expect(beIds.filter((id) => !feSet.has(id))).toEqual([]);
  });
});

describe("backend score_keys ↔ FE score labels", () => {
  const scoreKeys = parseBackendScoreKeys(backendSource);
  const labeled = new Set(Object.keys(SCORE_KEY_LABELS));

  it("fail-loud guard: parse found backend score_keys", () => {
    expect(scoreKeys.length).toBeGreaterThan(0);
  });

  it("every backend score_key has an FE label (no prettify fallback)", () => {
    const unlabeled = [...new Set(scoreKeys)].filter((k) => !labeled.has(k));
    expect(unlabeled).toEqual([]);
  });
});
