import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ NASKAH PLACEHOLDER — Skenario 3 (Keanggotaan Fiktif), PRD §7.3.
 *
 * NPC: Pak Bambang (Bendahara Senior). Dimensi drift: kecenderungan ke RUSAK
 * (nada menuduh/represif). Grounding: UU 25/1992 Pasal 17(2) & 30(1)(f), dilusi
 * SHU Pasal 5(1)(c). "Periksa Dokumen" adalah fitur FE statis, bukan backend.
 *
 * Naskah dialog & narasi asli ada di "dokumen skenario" yang tidak ada di repo.
 */
export const KEANGGOTAAN_FIKTIF_SCRIPT: ScenarioScript = {
  greeting: {
    name: "Pak Bambang",
    text: "Selamat pagi. Katanya Anda mau menanyakan daftar anggota? Saya sudah puluhan tahun pegang pembukuan koperasi ini, jadi silakan, apa yang mau diperiksa?",
  },
  npcTurns: [
    {
      name: "Pak Bambang",
      text: "Memang ada beberapa nama lama yang datanya belum lengkap. Tapi itu warisan pencatatan zaman dulu, bukan sesuatu yang saya sembunyikan.",
    },
    {
      name: "Pak Bambang",
      text: "Kalau Anda mau, kita cocokkan saja dengan buku induk. Saya tidak keberatan diverifikasi selama caranya baik dan berdasar data.",
    },
    {
      name: "Pak Bambang",
      text: "Betul, keanggotaan yang tidak sah bisa mendilusi pembagian SHU anggota riil. Saya setuju itu harus dibereskan sesuai aturan.",
    },
    {
      name: "Pak Bambang",
      text: "Baik, mari kita bersihkan data ini bersama-sama dan catat prosedurnya. Terima kasih sudah menegur dengan cara yang menjaga nama baik saya.",
    },
  ],
  drift: {
    escalate: [
      "tuduh",
      "korupsi",
      "maling",
      "pecat",
      "curang",
      "manipulasi",
      "penjara",
      "lapor",
      "bohong",
      "pembohong",
      "gelapkan",
    ],
    deescalate: [
      "verifikasi",
      "klarifikasi",
      "data",
      "prosedur",
      "audit",
      "bantu",
      "bersama",
      "paham",
      "cocokkan",
      "hormat",
    ],
    level1At: 2,
    level2At: 4,
  },
  forceQuitLine: {
    name: "Pak Bambang",
    text: "Saya sudah mengabdi puluhan tahun dan Anda menuduh saya seperti pencuri. Cukup. Saya tidak akan membantu proses ini lebih jauh. Selamat siang.",
  },
  endings: {
    good: {
      scenarioId: "keanggotaan-fiktif",
      trigger: "manual",
      stateClassification: {
        State_Verifikasi_Data: "DIBERSIHKAN",
        State_Relasi_NPC: "TERJAGA",
      },
      scores: { integritas_data: 90, compliance: 88, soft_skills: 86 },
      endingType: "good",
      narrativeFeedback:
        "Data anggota fiktif berhasil dibersihkan tanpa merusak hubungan dengan Pak Bambang. Anda menempatkan verifikasi di atas tuduhan, sejalan dengan kewajiban menjaga keabsahan keanggotaan (UU 25/1992 Pasal 17 & 30) dan melindungi SHU anggota riil dari dilusi (Pasal 5). Integritas data tegak, kolega tetap kooperatif.",
    },
    bad: {
      scenarioId: "keanggotaan-fiktif",
      trigger: "force_quit_level_2",
      stateClassification: {
        State_Verifikasi_Data: "DIBIARKAN",
        State_Relasi_NPC: "RUSAK",
      },
      scores: { integritas_data: 35, compliance: 40, soft_skills: 20 },
      endingType: "bad",
      narrativeFeedback:
        "Tuduhan tanpa verifikasi membuat Pak Bambang menutup diri, dan proses pembersihan data mandek sebelum tuntas. Kecurigaan boleh jadi berdasar, tetapi tanpa bukti dan tanpa menjaga martabat kolega, relasi kerja rusak dan keanggotaan fiktif justru tetap membebani koperasi.",
    },
  },
};
