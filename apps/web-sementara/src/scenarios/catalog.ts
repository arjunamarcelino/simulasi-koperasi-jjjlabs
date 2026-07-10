import type { ScenarioId } from "../transport/contract.provisional";

export type ScenarioStatus = "PLAYABLE" | "COMING_SOON";

export type ScenarioMeta = {
  id: ScenarioId;
  title: string;
  /** Nama persona NPC utama; null bila belum relevan. */
  npcName: string | null;
  blurb: string;
  difficulty: string;
  status: ScenarioStatus;
};

/**
 * Katalog lokal untuk menu + judul sesi. Padanan dari
 * apps/web/src/scenarios/scenario.config.ts, disalin (bukan diimpor) karena
 * lintas-app. RAT masih COMING_SOON — Skenario 4 belum dibangun di harness ini.
 */
export const SCENARIOS: readonly ScenarioMeta[] = [
  {
    id: "tutorial-koperasi-konsumen",
    title: "Tutorial — Koperasi Konsumen",
    npcName: "Ibu Rumah Tangga",
    blurb:
      "Pelajari alur dasar: melayani calon anggota, menjelaskan manfaat, lalu menuntaskan pendaftaran & Simpanan Pokok.",
    difficulty: "Tutorial",
    status: "PLAYABLE",
  },
  {
    id: "kredit-macet",
    title: "Kredit Macet",
    npcName: "Pak Joko",
    blurb:
      "Selidiki penyebab tunggakan angsuran Pak Joko dan tentukan penyelesaian yang sesuai prosedur — tanpa mengintimidasi.",
    difficulty: "Menengah",
    status: "PLAYABLE",
  },
  {
    id: "keanggotaan-fiktif",
    title: "Keanggotaan Fiktif",
    npcName: "Pak Bambang",
    blurb:
      "Ungkap dugaan keanggotaan fiktif bersama Bendahara Senior sambil menjaga integritas data dan hubungan kerja.",
    difficulty: "Lanjutan",
    status: "PLAYABLE",
  },
  {
    id: "rapat-anggota-tahunan",
    title: "Rapat Anggota Tahunan",
    npcName: "Pak Darma & Ibu Sri",
    blurb:
      "Pimpin RAT melewati tiga fase agenda di tengah dua anggota berseberangan — tekanan modal Pak Darma vs suara kecil Ibu Sri — dan jaga agar rapat tidak bubar.",
    difficulty: "Lanjutan",
    status: "PLAYABLE",
  },
];

export function getScenarioMeta(id: ScenarioId): ScenarioMeta {
  const meta = SCENARIOS.find((s) => s.id === id);
  if (!meta) throw new Error(`Skenario tidak dikenal: ${id}`);
  return meta;
}
