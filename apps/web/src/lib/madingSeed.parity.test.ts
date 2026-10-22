import { describe, expect, it } from "vitest";
import mading from "@simkop/catalog/data/mading.json";
import { parsePayload } from "./mading.types";

/**
 * Parity guard (SIM-18 review P2-3): run the ACTUAL seed content (packages/catalog/data/mading.json,
 * which bootstraps the DB) through the real learner parsers. The three validators (DB floor,
 * Pydantic, these TS parsers) are mirrored by hand, so this is the seam that fails the build the
 * moment a seed edit drifts into a shape the learner would render as `invalid`. Mirrors gen-seed:
 * the data slide's `id` becomes block_key and is stripped from the stored payload.
 */
describe("mading seed parses through the learner parsers", () => {
  it("identitas", () => {
    expect(parsePayload("identitas", mading.identitas)).not.toBeNull();
  });

  it("every info note", () => {
    for (const note of mading.info) expect(parsePayload("info", note)).not.toBeNull();
  });

  it("every data slide (id stripped → block_key)", () => {
    for (const { id, ...payload } of mading.data) {
      expect(typeof id).toBe("string"); // the slide id becomes block_key in the seed
      expect(parsePayload("data", payload)).not.toBeNull();
    }
  });

  it("every knowledge card", () => {
    for (const card of mading.knowledge) expect(parsePayload("knowledge", card)).not.toBeNull();
  });
});
