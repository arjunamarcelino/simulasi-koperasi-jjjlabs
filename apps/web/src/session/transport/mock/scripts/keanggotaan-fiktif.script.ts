import type { AuditorResult } from "../../contract";
import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ PLACEHOLDER SCRIPT. The real Keanggotaan Fiktif experience runs on the
 * LiveKit backend (Pak Bambang persona + drift observer + gpt-5.4 Auditor). This
 * mock only exists so the default `mock` transport doesn't crash on this scenario
 * and so the scored ResultPanel / drift nudge / force-quit can be exercised
 * offline. Dialogue is intentionally thin; the two endings carry the real backend
 * keys so the mock and the Auditor drive the SAME label path (resultLabels.ts).
 */

const GOOD_ENDING = {
  scenarioId: "keanggotaan-fiktif",
  trigger: "manual",
  stateClassification: {
    State_Verifikasi_Data: "DIBERSIHKAN",
    State_Relasi_NPC: "TERJAGA",
  },
  scores: { integritas_data: 88, compliance: 84, soft_skills: 82 },
  endingType: "good",
  narrativeFeedback:
    "Bagus! Anda memilih jalan tengah yang tepat — menaruh verifikasi di atas tuduhan. Dengan mengajak Pak Bambang mencocokkan ulang nama-nama janggal (KOP-0161 ganda, entri tanpa NIK/Simpanan Pokok) ke ketua RT/dusun, data fiktif dibereskan tanpa merusak hubungan. Hak SHU dan suara anggota asli terlindungi, sesuai UU 25/1992 Pasal 17(2) & 30(1)(f).",
} satisfies AuditorResult;

const BAD_ENDING = {
  scenarioId: "keanggotaan-fiktif",
  trigger: "force_quit_level_2",
  stateClassification: {
    State_Verifikasi_Data: "DIBIARKAN",
    State_Relasi_NPC: "RUSAK",
  },
  scores: { integritas_data: 32, compliance: 30, soft_skills: 25 },
  endingType: "bad",
  narrativeFeedback:
    "Misi gagal. Anda menuduh Pak Bambang memalsukan data dan mengancam pidana tanpa lebih dulu memverifikasi. Ia tersinggung, menutup diri, dan data fiktif tetap dibiarkan — hak SHU anggota asli terus terdilusi. Konfrontasi pengurus senior menuntut bukti dan kesantunan, bukan tuduhan sepihak.",
} satisfies AuditorResult;

export const KEANGGOTAAN_FIKTIF_SCRIPT = {
  greeting: {
    name: "Pak Bambang",
    text: "Silakan, Nak. Buku daftar anggota ada di meja itu. Saya sudah puluhan tahun pegang pembukuan koperasi ini, jadi kalau ada yang mau ditanyakan, tanya saja.",
  },
  npcTurns: [
    {
      name: "Pak Bambang",
      text: "Nomor KOP-0161 itu? Oh, itu peninggalan pencatatan lama. Ada yang sudah pindah, ada yang barangkali belum sempat saya rapikan.",
    },
    {
      name: "Pak Bambang",
      text: "Beberapa nama memang saya masukkan supaya jumlah anggota memenuhi kuota dari dinas — biar koperasi kita dapat bantuan hibah traktor. Niat saya untuk desa, lho.",
    },
    {
      name: "Pak Bambang",
      text: "Kalau soal Simpanan Pokok yang kosong seperti KOP-0178, ya memang mereka belum pernah menyetor. Saya paham itu tidak rapi.",
    },
    {
      name: "Pak Bambang",
      text: "Kalau memang lebih baik dicocokkan ulang ke ketua RT biar jelas mana yang pindah atau meninggal, ayo saja. Saya tidak mau merugikan warga yang benar-benar aktif.",
    },
  ],
  hints: [
    "Pak Bambang disegani — jangan langsung menuduh. Sapa dengan hormat dan buka 'Periksa Dokumen' dulu.",
    "Sebut satu kejanggalan konkret dari dokumen (mis. nomor ganda KOP-0161) dengan sopan, lalu tanyakan latarnya.",
    "Jelaskan sederhana: data fiktif mengurangi hak bonus (SHU) anggota yang benar-benar aktif — itu soal keadilan, bukan menyalahkan.",
    "Ajak sepakati verifikasi ulang ke ketua RT/dusun, lalu tekan 'Keputusan Akhir'.",
  ],
  drift: {
    escalate: ["pencuri", "korupsi", "penjara", "pidana", "pecat", "lapor polisi", "palsu", "tipu", "maling"],
    deescalate: [
      "verifikasi",
      "cek ulang",
      "cocokkan",
      "ketua rt",
      "bereskan",
      "hak anggota",
      "shu",
      "tolong",
      "paham",
    ],
    level1At: 2,
    level2At: 4,
  },
  forceQuitLine: {
    name: "Pak Bambang",
    text: "Kalau saya dituduh maling dan diancam begitu, saya tidak sudi melanjutkan. Silakan tempuh jalur resmi kalau berani.",
  },
  endings: {
    good: GOOD_ENDING,
    bad: BAD_ENDING,
  },
} satisfies ScenarioScript;
