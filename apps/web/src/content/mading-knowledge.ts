/**
 * Content for the koperasi "Papan Pengetahuan" (knowledge carousel) shown when
 * the player reads a poster near the entrance. Deliberately DIFFERENT from the
 * loading-screen trivia (koperasi-facts.ts): a mix of real SIMKOPDES dashboard
 * figures (`stat`) and program facts (`fact`). Only a selection of the dashboard
 * data is used — it's a light interlude, not the full dashboard.
 *
 * Data source (see KNOWLEDGE_SOURCE): https://simkopdes.go.id/pers/dashboard
 */

export type KnowledgeCard =
  | { kind: "stat"; value: string; label: string; group?: string; sub?: string }
  | { kind: "fact"; text: string };

/** Small attribution shown under the board (dashboard citation is permitted with source). */
export const KNOWLEDGE_SOURCE =
  "Sumber: Dashboard SIMKOPDES (2026), Kementerian Koperasi RI — simkopdes.go.id/pers/dashboard";

export const MADING_KNOWLEDGE_CARDS: readonly KnowledgeCard[] = [
  {
    kind: "stat",
    group: "Kesiapan Bisnis",
    value: "83.382",
    label: "Total Koperasi Desa/Kelurahan Merah Putih",
  },
  {
    kind: "fact",
    text: "Koperasi Desa/Kelurahan Merah Putih adalah program nasional untuk memperkuat ekonomi desa dan memangkas rantai tengkulak.",
  },
  {
    kind: "stat",
    group: "Kesiapan Bisnis",
    value: "60.774",
    label: "Koperasi telah memiliki NIB (Nomor Induk Berusaha)",
  },
  {
    kind: "fact",
    text: "Satu koperasi desa dapat menaungi banyak unit usaha sekaligus: sembako, simpan pinjam, apotek/klinik desa, hingga gudang & logistik.",
  },
  {
    kind: "stat",
    group: "Modal Koperasi",
    value: "Rp 41,5 M",
    label: "Total Simpanan Pokok anggota",
    sub: "Rp 41.522.871.015",
  },
  {
    kind: "stat",
    group: "Dampak Ekonomi",
    value: "Rp 56,6 M",
    label: "Nilai Transaksi sepanjang 2026",
    sub: "Rp 56.608.918.385",
  },
  {
    kind: "fact",
    text: "RAT (Rapat Anggota Tahunan) wajib digelar tiap tahun sebagai forum pertanggungjawaban pengurus kepada anggota.",
  },
  {
    kind: "stat",
    group: "Aktivitas RAT",
    value: "50.264",
    label: "Koperasi telah melaksanakan RAT",
  },
];
