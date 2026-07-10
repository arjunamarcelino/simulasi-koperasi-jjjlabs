import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ NASKAH PLACEHOLDER — Skenario 2 (Kredit Macet), PRD §7.2.
 *
 * NPC: Pak Joko (pemilik warung, menunggak cicilan). Dimensi drift: kecenderungan
 * ke MELANGGAR_PROSEDUR (nada mengancam/kaku berulang). Grounding narasi: asas
 * kekeluargaan (UU 25/1992), Permenkop No. 8/2023, mekanisme 3R.
 *
 * Naskah dialog & narasi asli ada di "dokumen skenario" yang tidak ada di repo.
 */
export const KREDIT_MACET_SCRIPT: ScenarioScript = {
  greeting: {
    name: "Pak Joko",
    text: "Aduh, Mas, maaf. Saya tahu cicilan bulan ini nunggak lagi. Warung lagi sepi betul sejak pasar direnovasi. Bukan saya kabur, sungguh.",
  },
  npcTurns: [
    {
      name: "Pak Joko",
      text: "Omzet turun hampir separuh, Mas. Stok pun terpaksa saya kurangi. Saya masih mau bayar, cuma butuh napas sebentar.",
    },
    {
      name: "Pak Joko",
      text: "Kalau boleh, angsurannya bisa diperkecil dulu nggak? Nanti begitu pasar ramai lagi saya kejar kekurangannya.",
    },
    {
      name: "Pak Joko",
      text: "Saya dengar koperasi bisa menjadwal ulang pinjaman ya? Saya bersedia ikut aturan, asal jangan sampai warung saya tutup.",
    },
    {
      name: "Pak Joko",
      text: "Terima kasih sudah mau mendengarkan, Mas. Jujur, saya lega kalau penyelesaiannya dibicarakan baik-baik seperti ini.",
    },
  ],
  drift: {
    escalate: [
      "sita",
      "usir",
      "ancam",
      "tuntut",
      "penjara",
      "polisi",
      "bohong",
      "tipu",
      "paksa",
      "lapor",
      "bodoh",
      "pengecut",
    ],
    deescalate: [
      "bantu",
      "cicil",
      "keringanan",
      "jadwal ulang",
      "restruktur",
      "paham",
      "solusi",
      "bersama",
      "tenang",
      "maaf",
    ],
    level1At: 2,
    level2At: 4,
  },
  forceQuitLine: {
    name: "Pak Joko",
    text: "Kalau caranya mengancam dan menghina begini, saya sudah tidak sanggup bicara lagi. Silakan urus lewat jalur Anda sendiri. Saya pamit.",
  },
  endings: {
    good: {
      scenarioId: "kredit-macet",
      trigger: "manual",
      stateClassification: {
        State_Analisis_Masalah: "BENAR",
        State_Jalur_Remedi: "SESUAI",
      },
      scores: { member_centric: 88, compliance: 90, soft_skills: 85 },
      endingType: "good",
      narrativeFeedback:
        "Anda menegakkan asas kekeluargaan (UU 25/1992) tanpa mengorbankan prosedur. Dengan menggali sebab tunggakan lebih dulu, lalu menawarkan jalur 3R (rescheduling/reconditioning/restructuring) sesuai Permenkop No. 8/2023, Pak Joko tetap kooperatif dan pinjaman punya peluang pulih. Inilah penyelesaian yang menjaga anggota sekaligus kesehatan koperasi.",
    },
    bad: {
      scenarioId: "kredit-macet",
      trigger: "force_quit_level_2",
      stateClassification: {
        State_Analisis_Masalah: "BENAR",
        State_Jalur_Remedi: "MELANGGAR_PROSEDUR",
      },
      scores: { member_centric: 30, compliance: 35, soft_skills: 25 },
      endingType: "bad",
      narrativeFeedback:
        "Pendekatan mengintimidasi membuat Pak Joko menutup diri sebelum solusi apa pun tercapai. Ancaman penyitaan sepihak melangkahi mekanisme 3R dan mengingkari asas kekeluargaan koperasi. Analisis masalah boleh jadi benar, tetapi jalur remedinya melanggar prosedur — hubungan rusak dan pinjaman tetap macet.",
    },
  },
};
