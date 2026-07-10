import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ NASKAH PLACEHOLDER.
 *
 * PRD 7.1 hanya menjelaskan BENTUK skenario tutorial (satu NPC ibu rumah
 * tangga non-anggota, linear, berakhir di "Bayar & Daftar" dengan pesan selamat
 * tetap). Naskah dialog aslinya ada di "dokumen skenario" yang tidak ada di
 * repo ini. Ganti isi di bawah begitu naskah asli tersedia — arsitekturnya
 * tidak ikut berubah.
 */
export const TUTORIAL_SCRIPT: ScenarioScript = {
  greeting: {
    name: "Ibu Rumah Tangga",
    text: "Selamat siang, Mas. Saya dengar belanja di sini bisa lebih murah, ya? Tapi saya belum jadi anggota koperasi.",
  },
  npcTurns: [
    {
      name: "Ibu Rumah Tangga",
      text: "Oh, jadi kalau saya mendaftar jadi anggota, harganya bisa lebih hemat? Kira-kira bedanya berapa, ya?",
    },
    {
      name: "Ibu Rumah Tangga",
      text: "Simpanan Pokok itu maksudnya bayar sekali di awal? Uangnya hangus, atau tetap jadi milik saya?",
    },
    {
      name: "Ibu Rumah Tangga",
      text: "Kalau ada Sisa Hasil Usaha di akhir tahun, anggota kebagian juga? Menarik juga ternyata.",
    },
    {
      name: "Ibu Rumah Tangga",
      text: "Baik, saya sudah paham. Saya mau mendaftar sekalian membayar Simpanan Pokoknya. Bagaimana caranya, Mas?",
    },
  ],
  endings: {
    good: {
      scenarioId: "tutorial-koperasi-konsumen",
      trigger: "manual",
      stateClassification: {},
      scores: {},
      endingType: "good",
      narrativeFeedback:
        "Selamat! Ibu tadi resmi terdaftar sebagai anggota dan telah membayar Simpanan Pokok. Anda baru saja menuntaskan transaksi koperasi konsumen pertama Anda — mendaftar, menyimpan, lalu menikmati manfaat sebagai anggota. Alur dasar ini akan terus dipakai di skenario berikutnya.",
    },
  },
};
