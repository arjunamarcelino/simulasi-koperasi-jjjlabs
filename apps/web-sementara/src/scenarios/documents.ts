import type { ScenarioId } from "../transport/contract.provisional";

export type DocRow = { nama: string; noAnggota: string; status: string };

/**
 * Konten "Periksa Dokumen" (PRD §7.3/§7.4) — fitur FE murni, data statis,
 * tanpa backend/AI. Bentuknya bisa tabel (rows) atau paragraf.
 */
export type ScenarioDocument = {
  buttonLabel: string;
  title: string;
  rows?: readonly DocRow[];
  paragraphs?: readonly string[];
};

export const SCENARIO_DOCUMENTS: Partial<
  Record<ScenarioId, ScenarioDocument>
> = {
  "keanggotaan-fiktif": {
    buttonLabel: "Periksa Dokumen",
    title: "Daftar Anggota (cuplikan)",
    rows: [
      { nama: "Siti Aminah", noAnggota: "KOP-0142", status: "Data lengkap" },
      { nama: "Budi Santoso", noAnggota: "KOP-0155", status: "Data lengkap" },
      { nama: "(kosong)", noAnggota: "KOP-0161", status: "Tanpa NIK / alamat" },
      { nama: "R. Wibowo", noAnggota: "KOP-0161", status: "No. anggota ganda" },
      { nama: "(kosong)", noAnggota: "KOP-0178", status: "Tanpa simpanan pokok" },
    ],
  },
  "rapat-anggota-tahunan": {
    buttonLabel: "Periksa Tata Tertib",
    title: "Tata Tertib RAT (cuplikan)",
    paragraphs: [
      "Pasal 1 — Rapat sah bila kuorum tercapai sesuai AD/ART (UU 25/1992 Pasal 22).",
      "Pasal 2 — Setiap anggota memiliki satu suara, tidak bergantung besarnya modal (Pasal 5 ayat 1).",
      "Pasal 3 — Keputusan diambil melalui musyawarah untuk mufakat; bila tidak tercapai, ditempuh pemungutan suara.",
      "Pasal 4 — Pimpinan rapat menjaga ketertiban; interupsi disampaikan melalui pimpinan, bukan saling menyela.",
      "Pasal 5 — Keputusan yang diambil di luar prosedur ini tidak berlaku dan tidak mengikat.",
    ],
  },
};
