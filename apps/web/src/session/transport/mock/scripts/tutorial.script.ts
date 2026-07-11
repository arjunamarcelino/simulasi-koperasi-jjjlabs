import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ PLACEHOLDER SCRIPT. PRD §7.1 describes only the SHAPE of the tutorial
 * (one non-member housewife NPC, linear, ending at "Bayar & Daftar" with a fixed
 * congratulations message). Swap the dialogue when the real script lands — the
 * architecture doesn't change.
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
  // The ibu agrees to register on her 4th turn (index 3) → goal reached.
  goalAtTurn: 3,
  hints: [
    "Layani dulu pembelian minyak gorengnya, lalu tawari ibu menjadi anggota agar harganya lebih murah.",
    "Jelaskan bedanya: sebagai anggota harganya turun (mis. dari Rp65.000 jadi Rp58.000) dan tiap belanja dicatat untuk bonus SHU akhir tahun.",
    "Terangkan Simpanan Pokok: dibayar sekali di awal dan tetap jadi milik ibu, bukan biaya yang hangus. Sebutkan juga ada Simpanan Wajib berkala.",
    "Ibu sudah paham dan tertarik — ajak ia mendaftar sekarang lalu tekan tombol 'Bayar & Daftar' untuk menuntaskan pendaftaran sekaligus pembayaran.",
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
