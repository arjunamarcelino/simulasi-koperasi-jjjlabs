/**
 * Content for the koperasi "Papan Info Penting" (sticky-note board), shown when
 * the player reads a mading near the entrance. Presentation-agnostic: `accent`
 * is a semantic token; the Tailwind classes live in MadingInfoBoard.tsx.
 *
 * All figures are placeholder dummies (the live SIMKOPDES dashboard is still 0).
 * Edit freely.
 */

export type NoteAccent = "mustard" | "forest" | "orange" | "parchment";

export type MadingNote = {
  title: string;
  lines: readonly string[];
  accent: NoteAccent;
};

/** Koperasi identity — rendered as the board header. */
export const KOPERASI_IDENTITAS = {
  nama: "Koperasi Desa Merah Putih Sukamaju",
  badanHukum: "Badan Hukum: AHU-0001234.AH.01.29.Tahun 2026",
  alamat: "Jl. Koperasi No. 1, Desa Sukamaju",
  desa: "Kec. Cibadak, Kab. Sukabumi",
} as const;

export const MADING_INFO_NOTES: readonly MadingNote[] = [
  {
    title: "Jadwal RAT",
    accent: "mustard",
    lines: ["RAT Tutup Buku 2025", "Sabtu, 15 Feb 2026 · 09.00", "Balai Desa Sukamaju"],
  },
  {
    title: "Simpanan (Agregat)",
    accent: "forest",
    lines: ["Pokok: Rp 42.500.000", "Wajib: Rp 128.900.000", "Sukarela: Rp 76.300.000"],
  },
  {
    title: "Pinjaman (Agregat)",
    accent: "orange",
    lines: ["Beredar: Rp 214.000.000", "Lancar: 92%", "Bermasalah: 8%"],
  },
  {
    title: "Jumlah Anggota",
    accent: "parchment",
    lines: ["Total: 340 anggota", "Aktif: 318", "Anggota baru 2026: 27"],
  },
  {
    title: "Struktur Pengurus",
    accent: "mustard",
    lines: ["Ketua: Budi Santoso", "Sekretaris: Ani Wijaya", "Bendahara: Dewi Kartika"],
  },
  {
    title: "Penjualan (Agregat)",
    accent: "forest",
    lines: ["Omzet 2025: Rp 1,2 M", "Unit: Sembako & Simpan Pinjam", "SHU: Rp 96.000.000"],
  },
];
