import { describe, it, expect } from "vitest";
// Vite `?raw` inlines the backend file as a string at transform time — no node:fs,
// no @types/node (the repo deliberately avoids it; see vite.config.ts). A moved or
// renamed scenarios.py makes this import fail to resolve → a loud build-time failure.
import backendSource from "../../../../apps/backend/voice_worker/scenarios.py?raw";
import { SCENARIOS as FE_SCENARIOS } from "./scenario.config";
import { SCENARIOS as CATALOG_SCENARIOS } from "@simkop/catalog";

/**
 * Extracts the backend's scenario ids by matching the `scenario_id="..."` assignment
 * literals. Deliberately ignores the field declaration (`scenario_id: str`), the
 * registry dict keys (`TUTORIAL.scenario_id:`), and the `get_scenario` parameter —
 * none of those are `scenario_id = "<literal>"`.
 */
function parseBackendScenarioIds(src: string): string[] {
  return [...src.matchAll(/scenario_id\s*=\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((id): id is string => id !== undefined);
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
