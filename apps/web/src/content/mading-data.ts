/**
 * Content for the koperasi "Papan Data" (3-slide carousel) in the ruang rapat.
 * A generic table shape ({ headers, rows }) drives one renderer across three
 * different column schemas. Values are pre-formatted display strings — all
 * placeholder dummies. Edit freely.
 */

export type ColAlign = "left" | "right";

export type MadingSlide = {
  id: string;
  title: string;
  caption?: string;
  headers: readonly string[];
  /** Per-column alignment; defaults to "left" when omitted for a column. */
  align?: readonly ColAlign[];
  rows: readonly (readonly string[])[];
};

export const MADING_DATA_SLIDES: readonly MadingSlide[] = [
  {
    id: "anggota",
    title: "Daftar Anggota",
    caption: "6 dari 340 anggota — data contoh",
    headers: ["No", "Nama", "No. Anggota", "Status"],
    align: ["left", "left", "left", "left"],
    rows: [
      ["1", "Budi Santoso", "AGT-0001", "Aktif"],
      ["2", "Ani Wijaya", "AGT-0002", "Aktif"],
      ["3", "Dewi Kartika", "AGT-0003", "Aktif"],
      ["4", "Slamet Riyadi", "AGT-0004", "Aktif"],
      ["5", "Siti Aminah", "AGT-0005", "Nonaktif"],
      ["6", "Joko Susilo", "AGT-0006", "Aktif"],
    ],
  },
  {
    id: "simpanan",
    title: "Daftar Simpanan",
    caption: "data contoh",
    headers: ["Nama", "Pokok", "Wajib", "Sukarela"],
    align: ["left", "right", "right", "right"],
    rows: [
      ["Budi Santoso", "Rp 100.000", "Rp 600.000", "Rp 250.000"],
      ["Ani Wijaya", "Rp 100.000", "Rp 600.000", "Rp 1.000.000"],
      ["Dewi Kartika", "Rp 100.000", "Rp 480.000", "Rp 150.000"],
      ["Slamet Riyadi", "Rp 100.000", "Rp 720.000", "Rp 0"],
      ["Siti Aminah", "Rp 100.000", "Rp 360.000", "Rp 500.000"],
      ["Joko Susilo", "Rp 100.000", "Rp 600.000", "Rp 300.000"],
    ],
  },
  {
    id: "pinjaman",
    title: "Daftar Pinjaman",
    caption: "data contoh",
    headers: ["Nama", "Jumlah", "Tenor", "Status"],
    align: ["left", "right", "left", "left"],
    rows: [
      ["Budi Santoso", "Rp 5.000.000", "12 bln", "Lancar"],
      ["Ani Wijaya", "Rp 3.000.000", "6 bln", "Lancar"],
      ["Dewi Kartika", "Rp 8.000.000", "24 bln", "Lancar"],
      ["Slamet Riyadi", "Rp 2.500.000", "6 bln", "Bermasalah"],
      ["Siti Aminah", "Rp 4.000.000", "12 bln", "Lancar"],
      ["Joko Susilo", "Rp 6.000.000", "18 bln", "Bermasalah"],
    ],
  },
];
