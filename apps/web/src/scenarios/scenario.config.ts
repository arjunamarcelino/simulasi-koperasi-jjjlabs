import type { ScenarioConfig } from "../types/scenario";

/**
 * Config-driven scenario list. The headline scenario for this project is
 * Rapat Anggota Tahunan (RAT); the rest are placeholders ("Segera Hadir")
 * until their mechanics are designed.
 */
export const SCENARIOS: readonly ScenarioConfig[] = [
  {
    id: "rapat-anggota-tahunan",
    title: "Rapat Anggota Tahunan",
    shortDescription:
      "Pimpin jalannya RAT: kelola agenda, dengarkan anggota, dan ambil keputusan yang menjaga amanah koperasi.",
    difficulty: "Lanjutan",
    status: "AVAILABLE",
  },
  {
    id: "kredit-macet",
    title: "Kredit Macet",
    shortDescription:
      "Selidiki penyebab seorang anggota gagal membayar angsuran pinjaman dan tentukan penyelesaian yang tepat.",
    difficulty: "Menengah",
    status: "COMING_SOON",
  },
  {
    id: "keanggotaan-fiktif",
    title: "Keanggotaan Fiktif",
    shortDescription:
      "Ungkap dugaan keanggotaan fiktif dan jaga integritas data anggota koperasi.",
    difficulty: "Lanjutan",
    status: "COMING_SOON",
  },
  {
    id: "tutorial-koperasi-konsumen",
    title: "Tutorial — Koperasi Konsumen",
    shortDescription:
      "Pelajari pergerakan, interaksi NPC, dan transaksi koperasi sederhana.",
    difficulty: "Tutorial",
    status: "AVAILABLE",
    gatesEndOnGoal: true,
    npcName: "Ibu Rumah Tangga",
    blurb:
      "Pelajari alur dasar: melayani calon anggota, menjelaskan manfaat, lalu menuntaskan pendaftaran & Simpanan Pokok.",
    mission:
      "Layani ibu yang belanja minyak goreng, tawarkan keanggotaan, lalu tuntaskan pendaftaran + Simpanan Pokok.",
    steps: [
      "Sapa ibu dan layani pembelian minyak gorengnya lebih dulu.",
      "Tawarkan keanggotaan: harga anggota lebih murah dan tiap belanja dicatat untuk bonus SHU akhir tahun.",
      "Jelaskan Simpanan Pokok (sekali bayar, tetap milik anggota) dan Simpanan Wajib (berkala) dengan sabar.",
      "Setelah ibu setuju, tekan 'Bayar & Daftar' untuk menuntaskan pendaftaran sekaligus pembayaran.",
    ],
  },
];
