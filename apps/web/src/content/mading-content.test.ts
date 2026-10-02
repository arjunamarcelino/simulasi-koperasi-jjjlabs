import { describe, expect, it } from "vitest";
import { MADING_KNOWLEDGE_CARDS, type KnowledgeCard } from "./mading-knowledge";
import { MADING_INFO_NOTES } from "./mading-info";
import { KOPERASI_FACTS } from "./koperasi-facts";

/**
 * Content invariants for the micro-learning boards (SIM-10). Pure value-level
 * assertions over static arrays (node env) — only the invariants that protect an
 * accuracy claim or catch a silent runtime bug TypeScript cannot. Shape/union and
 * accent validity are already guaranteed by the compiler, so they are not re-tested.
 */

const isFact = (c: KnowledgeCard): c is Extract<KnowledgeCard, { kind: "fact" }> =>
  c.kind === "fact";

const facts = MADING_KNOWLEDGE_CARDS.filter(isFact);
const principles = facts.filter((c) => c.chip === "Prinsip Koperasi");

describe("mading-knowledge — principles series", () => {
  it("P1: has exactly 7 principle cards", () => {
    expect(principles).toHaveLength(7);
  });

  it("E2: numbers principles ke-1..ke-7, consecutive and in ascending order", () => {
    // Positions within the full card array must be contiguous (nav reads as a set).
    const positions = MADING_KNOWLEDGE_CARDS.reduce<number[]>((acc, c, i) => {
      if (c.kind === "fact" && c.chip === "Prinsip Koperasi") acc.push(i);
      return acc;
    }, []);
    for (let k = 1; k < positions.length; k++) {
      expect(positions[k]).toBe(positions[k - 1]! + 1);
    }
    // ...and labeled "Prinsip ke-N" in order.
    principles.forEach((card, i) => {
      expect(card.text.startsWith(`Prinsip ke-${i + 1} `)).toBe(true);
    });
  });

  it("P2: has one 'Landasan Hukum' card citing Pasal 33 and UU 25/1992", () => {
    const legal = facts.filter((c) => c.chip === "Landasan Hukum");
    expect(legal).toHaveLength(1);
    expect(legal[0]!.text).toContain("UUD 1945 Pasal 33");
    expect(legal[0]!.text).toContain("UU No. 25 Tahun 1992");
  });
});

describe("mading-info — notes", () => {
  it("E1: note titles are unique (rendered as React keys)", () => {
    const titles = MADING_INFO_NOTES.map((n) => n.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("includes the 'Prinsip Koperasi' summary note", () => {
    expect(MADING_INFO_NOTES.some((n) => n.title === "Prinsip Koperasi")).toBe(true);
  });
});

describe("koperasi-facts — loading trivia", () => {
  it("N1: has no duplicate entries", () => {
    expect(new Set(KOPERASI_FACTS).size).toBe(KOPERASI_FACTS.length);
  });
});
