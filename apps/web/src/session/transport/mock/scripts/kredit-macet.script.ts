import type { AuditorResult } from "../../contract";
import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ PLACEHOLDER SCRIPT. The real Kredit Macet experience runs on the LiveKit
 * backend (persona + drift observer + gpt-5.4 Auditor). This mock only exists so
 * the default `mock` transport doesn't crash on this scenario and so the scored
 * ResultPanel / drift nudge / force-quit can be exercised offline. Dialogue is
 * intentionally thin; the two endings carry the real backend keys so the mock
 * and the Auditor drive the SAME label path (resultLabels.ts).
 */

const GOOD_ENDING = {
  scenarioId: "kredit-macet",
  trigger: "manual",
  stateClassification: {
    State_Analisis_Masalah: "BENAR",
    State_Jalur_Remedi: "SESUAI",
  },
  scores: { member_centric: 88, compliance: 82, soft_skills: 79 },
  endingType: "good",
  narrativeFeedback:
    "Selamat! Anda menegakkan asas kekeluargaan tanpa mengorbankan prosedur. Dengan menggali sebab tunggakan — akses jalan tertutup proyek membuat omzet warung anjlok — lalu menawarkan keringanan dan perpanjangan tempo (Restrukturisasi/3R), Pak Joko tetap kooperatif dan pinjaman berpeluang pulih secara sah.",
} satisfies AuditorResult;

const BAD_ENDING = {
  scenarioId: "kredit-macet",
  trigger: "force_quit_level_2",
  stateClassification: {
    State_Analisis_Masalah: "SALAH",
    State_Jalur_Remedi: "MELANGGAR_PROSEDUR",
  },
  scores: { member_centric: 35, compliance: 30, soft_skills: 28 },
  endingType: "bad",
  narrativeFeedback:
    "Misi gagal. Anda menekan dan mengancam menyita tanpa lebih dulu menggali kondisi nyata Pak Joko. Menghadapi anggota beritikad baik yang tertimpa musibah, koperasi punya mekanisme resmi bernama Restrukturisasi — bukan penyitaan sepihak yang melangkahi prosedur dan merusak asas kekeluargaan.",
} satisfies AuditorResult;

export const KREDIT_MACET_SCRIPT = {
  greeting: {
    name: "Pak Joko",
    text: "Iya, saya tahu cicilan saya nunggak dua bulan. Tapi saya bukan mau kabur dari kewajiban, ya. Keadaannya lagi susah.",
  },
  npcTurns: [
    {
      name: "Pak Joko",
      text: "Warung saya sepi sekali belakangan ini. Bukan alasan, tapi memang pembeli susah masuk.",
    },
    {
      name: "Pak Joko",
      text: "Jalan depan warung dibongkar buat proyek drainase sama pengaspalan. Sudah tiga bulan aksesnya ketutup total.",
    },
    {
      name: "Pak Joko",
      text: "Omzet saya turun sampai delapan puluh persen. Ini nota-nota penjualannya kalau mau lihat sendiri.",
    },
    {
      name: "Pak Joko",
      text: "Kalau ada keringanan atau tempo diperpanjang sampai proyeknya kelar, saya sanggup lanjut bayar. Saya cuma butuh nafas sebentar.",
    },
  ],
  hints: [
    "Pak Joko defensif — jangan langsung menuduh. Tanyakan dulu kabar usahanya dengan tenang.",
    "Gali sebab objektif: minta izin melihat bukti (buka 'Periksa Bukti') dan tanyakan kenapa warungnya sepi.",
    "Ingat asas kekeluargaan: untuk anggota beritikad baik yang kena musibah, ada mekanisme 3R (Rescheduling/Reconditioning/Restructuring).",
    "Setelah paham kondisinya, sampaikan solusi keringanan/perpanjangan tempo lewat percakapan, lalu tekan 'Keputusan Akhir'.",
  ],
  drift: {
    escalate: ["sita", "ancam", "polisi", "usir", "bayar sekarang", "paksa", "lelang", "rampas"],
    deescalate: [
      "bantu",
      "paham",
      "keringanan",
      "restrukturisasi",
      "perpanjang",
      "solusi",
      "tenang",
      "musibah",
    ],
    level1At: 2,
    level2At: 4,
  },
  forceQuitLine: {
    name: "Pak Joko",
    text: "Kalau caranya mengancam begini, saya tidak mau lanjut bicara. Silakan urus lewat jalur resmi saja.",
  },
  endings: {
    good: GOOD_ENDING,
    bad: BAD_ENDING,
  },
} satisfies ScenarioScript;
