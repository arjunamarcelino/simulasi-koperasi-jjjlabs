import { describe, expect, it } from "vitest";
import mading from "@simkop/catalog/data/mading.json";
import { KOPERASI_FACTS } from "./koperasi-facts";

/**
 * Content-accuracy invariants for the micro-learning mading (SIM-10/SIM-18). The mading content
 * now lives in the shared catalog (packages/catalog/data/mading.json), which bootstraps the DB —
 * so these assertions guard the SEED (the source of truth), not the retired FE constants. Only
 * invariants that protect an accuracy claim TypeScript can't; shape validity is covered by the
 * mading.types parser tests + the DB floor.
 */

type KnowledgeCard =
  | { kind: "stat"; value: string; label: string; group?: string; sub?: string }
  | { kind: "fact"; text: string; chip?: string };
type Note = { title: string; lines: string[]; accent: string };

const knowledge = mading.knowledge as KnowledgeCard[];
const info = mading.info as Note[];

const facts = knowledge.filter((c): c is Extract<KnowledgeCard, { kind: "fact" }> => c.kind === "fact");
const principles = facts.filter((c) => c.chip === "Prinsip Koperasi");

describe("mading-knowledge — principles series", () => {
  it("has exactly 7 principle cards", () => {
    expect(principles).toHaveLength(7);
  });

  it("numbers the principles ke-1 through ke-7 in order", () => {
    principles.forEach((card, i) => {
      expect(card.text.startsWith(`Prinsip ke-${i + 1} `)).toBe(true);
    });
  });

  it("cites Pasal 33 and UU 25/1992 in the legal-framing card", () => {
    const legal = facts.filter((c) => c.chip === "Landasan Hukum");
    expect(legal).toHaveLength(1);
    expect(legal[0]!.text).toContain("UUD 1945 Pasal 33");
    expect(legal[0]!.text).toContain("UU No. 25 Tahun 1992");
  });
});

describe("mading-info — notes", () => {
  it("keeps note titles unique", () => {
    const titles = info.map((n) => n.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("koperasi-facts — loading trivia", () => {
  it("has no duplicate entries", () => {
    expect(new Set(KOPERASI_FACTS).size).toBe(KOPERASI_FACTS.length);
  });
});
