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
    text: "NIB, NPWP, dan rekening bank adalah penanda kesiapan koperasi berbisnis secara legal dan bankable.",
  },
  {
    kind: "stat",
    group: "Kesiapan Bisnis",
    value: "60.774",
    label: "Koperasi telah memiliki NIB (Nomor Induk Berusaha)",
  },
  {
    kind: "fact",
    text: "Simpanan pokok dibayar sekali saat mendaftar, sedangkan simpanan wajib disetor rutin — keduanya membentuk modal bersama koperasi.",
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
    text: "Pelaksanaan RAT dipantau bertahap di SIMKOPDES: draft → dilaporkan → diverifikasi Dinas Koperasi.",
  },
  {
    kind: "stat",
    group: "Aktivitas RAT",
    value: "50.264",
    label: "Koperasi telah melaksanakan RAT",
  },
];
