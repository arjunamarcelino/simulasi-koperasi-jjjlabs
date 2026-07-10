import type { ScenarioId } from "../transport/contract.provisional";

export type ScenarioStatus = "PLAYABLE" | "COMING_SOON";

export type ScenarioMeta = {
  id: ScenarioId;
  title: string;
  /** Nama persona NPC utama; null bila belum relevan. */
  npcName: string | null;
  blurb: string;
  /** Misi ringkas — apa yang harus dicapai pemain (1 kalimat). */
  mission: string;
  /**
   * Langkah konkret "yang perlu kamu lakukan", untuk membantu pemain (terutama
   * yang belum paham koperasi) tahu harus mulai dari mana. Ditampilkan di
   * panel briefing dalam sesi.
   */
  steps: readonly string[];
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
    mission:
      "Layani ibu yang belanja minyak goreng, tawarkan keanggotaan, lalu tuntaskan pendaftaran + Simpanan Pokok.",
    steps: [
      "Sapa ibu dan layani pembelian minyak gorengnya lebih dulu.",
      "Tawarkan keanggotaan: harga anggota lebih murah (mis. Rp58.000 vs Rp65.000) dan tiap belanja dicatat untuk bonus SHU akhir tahun.",
      "Jelaskan Simpanan Pokok (dibayar sekali, tetap jadi milik anggota) dan Simpanan Wajib (berkala) dengan sabar.",
      "Setelah ibu setuju, tekan tombol 'Bayar & Daftar' untuk menuntaskan pendaftaran sekaligus pembayaran.",
    ],
    difficulty: "Tutorial",
    status: "PLAYABLE",
  },
  {
    id: "kredit-macet",
    title: "Kredit Macet",
    npcName: "Pak Joko",
    blurb:
      "Selidiki penyebab tunggakan angsuran Pak Joko dan tentukan penyelesaian yang sesuai prosedur — tanpa mengintimidasi.",
    mission:
      "Gali sebab tunggakan Pak Joko secara objektif, lalu pilih penyelesaian yang sesuai prosedur & berempati.",
    steps: [
      "Tanyakan kondisi warung dan sebab tunggakan; minta bukti riil (mis. nota penjualan, proyek jalan yang menutup akses).",
      "Tunjukkan empati dan tegakkan asas kekeluargaan — jangan menuduh atau mengancam menyita.",
      "Tawarkan restrukturisasi 3R (Rescheduling/Reconditioning/Restructuring) bila itikadnya baik.",
      "Ambil 'Keputusan Akhir' setelah investigasi cukup.",
    ],
    difficulty: "Menengah",
    status: "PLAYABLE",
  },
  {
    id: "keanggotaan-fiktif",
    title: "Keanggotaan Fiktif",
    npcName: "Pak Bambang",
    blurb:
      "Ungkap dugaan keanggotaan fiktif bersama Bendahara Senior sambil menjaga integritas data dan hubungan kerja.",
    mission:
      "Bersihkan data anggota fiktif bersama Pak Bambang tanpa merusak hubungan kerja.",
    steps: [
      "Buka 'Periksa Dokumen' untuk memverifikasi kejanggalan (nama tanpa NIK / tanpa Simpanan Wajib) sebagai bukti.",
      "Sampaikan temuan dengan santun; tekankan data fiktif mengurangi hak SHU anggota asli.",
      "Ajak verifikasi ulang bersama (mis. cek ke ketua RT/dusun) — hindari menuduh memalsukan atau mengancam pidana.",
      "Ambil 'Keputusan Akhir' setelah data disepakati untuk dibersihkan.",
    ],
    difficulty: "Lanjutan",
    status: "PLAYABLE",
  },
  {
    id: "rapat-anggota-tahunan",
    title: "Rapat Anggota Tahunan",
    npcName: "Pak Darma & Ibu Sri",
    blurb:
      "Pimpin RAT melewati tiga fase agenda di tengah dua anggota berseberangan — tekanan modal Pak Darma vs suara kecil Ibu Sri — dan jaga agar rapat tidak bubar.",
    mission:
      "Pimpin RAT sampai tuntas secara demokratis tanpa tunduk pada tekanan modal maupun membuat rapat bubar.",
    steps: [
      "Fase 1 — pastikan kuorum lalu buka rapat (ketok palu).",
      "Fase 2 — bacakan LPJ; saat Pak Darma menginterupsi & mengancam menarik modal, tetap tenang.",
      "Tegakkan tata tertib: satu anggota satu suara; modal besar tidak membeli hak suara. Panggil nama NPC untuk berbicara ke salah satunya.",
      "Fase 3 — selesaikan lewat musyawarah/voting yang adil, lalu ambil 'Keputusan Akhir'.",
    ],
    difficulty: "Lanjutan",
    status: "PLAYABLE",
  },
];

export function getScenarioMeta(id: ScenarioId): ScenarioMeta {
  const meta = SCENARIOS.find((s) => s.id === id);
  if (!meta) throw new Error(`Skenario tidak dikenal: ${id}`);
  return meta;
}
