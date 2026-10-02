import { describe, expect, it } from "vitest";
import { MADING_KNOWLEDGE_CARDS, type KnowledgeCard } from "./mading-knowledge";
import { MADING_INFO_NOTES } from "./mading-info";
import { KOPERASI_FACTS } from "./koperasi-facts";

/**
 * Content invariants for the micro-learning boards (SIM-10). Pure value-level
 * assertions over static arrays (node env) — only invariants that protect an accuracy
 * claim or catch a silent runtime bug TypeScript cannot. Shape/union/accent validity
 * and the `chip` label spelling are already guaranteed by the compiler, so they are
 * not re-tested here.
 */

const isFact = (c: KnowledgeCard): c is Extract<KnowledgeCard, { kind: "fact" }> =>
  c.kind === "fact";

const facts = MADING_KNOWLEDGE_CARDS.filter(isFact);
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
  it("keeps note titles unique (they are used as React keys)", () => {
    const titles = MADING_INFO_NOTES.map((n) => n.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("koperasi-facts — loading trivia", () => {
  it("has no duplicate entries", () => {
    expect(new Set(KOPERASI_FACTS).size).toBe(KOPERASI_FACTS.length);
  });
});
