/**
 * Content for the koperasi "Papan Pengetahuan" (knowledge carousel), shown when
 * the player reads a poster near the entrance. A mix of `stat` cards (data /
 * statistik) and `fact` cards (fakta). Facts are reused from koperasi-facts.ts.
 * Stat figures are placeholder dummies — edit freely.
 */

import { KOPERASI_FACTS } from "./koperasi-facts";

export type KnowledgeCard =
  | { kind: "stat"; value: string; label: string; sub?: string }
  | { kind: "fact"; text: string };

const STATS: readonly KnowledgeCard[] = [
  {
    kind: "stat",
    value: "80.000+",
    label: "Target Koperasi Desa/Kelurahan Merah Putih",
    sub: "di seluruh Indonesia",
  },
  {
    kind: "stat",
    value: "12 Juli",
    label: "Hari Koperasi Nasional",
  },
  {
    kind: "stat",
    value: "Pasal 33",
    label: "Landasan koperasi dalam UUD 1945",
    sub: "berasas kekeluargaan",
  },
];

// Interleave stat ↔ fakta so the deck alternates as the player slides through it.
export const MADING_KNOWLEDGE_CARDS: readonly KnowledgeCard[] = STATS.flatMap(
  (stat, i) => {
    const fact = KOPERASI_FACTS[i];
    return fact ? [stat, { kind: "fact", text: fact } as KnowledgeCard] : [stat];
  },
);
