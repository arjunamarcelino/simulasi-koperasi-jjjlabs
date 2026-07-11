import type { AuditorResult } from "../../contract";
import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ PLACEHOLDER SCRIPT. The real RAT experience runs on the LiveKit backend
 * (two simultaneous personas — Pak Darma & Ibu Sri — + drift observer + gpt-5.4
 * Auditor). This mock exists so the default `mock` transport can drive RAT
 * offline: the two-persona / three-phase machine (script.rat), drift → BUBAR
 * force-quit, and the scored ResultPanel. Dialogue is intentionally thin; the two
 * endings carry the real backend state keys so mock and Auditor share the SAME
 * label path (resultLabels.ts).
 *
 * Persona routing: the transport picks the responder by name-mention keyword
 * (nameMentions) else the phase's default persona. Phase 2's default persona and
 * its scripted `entryEvent` are BOTH "darma" on purpose, so the interruption
 * highlights Darma without a separate active-speaker fix.
 */

const GOOD_ENDING = {
  scenarioId: "rapat-anggota-tahunan",
  trigger: "manual",
  stateClassification: {
    State_Proses_Rapat: "TUNTAS",
    State_Keabsahan_Keputusan: "SAH_DEMOKRATIS",
  },
  scores: { member_centric: 88, compliance: 90, soft_skills: 85 },
  endingType: "good",
  narrativeFeedback:
    "Selamat! Anda memimpin RAT dengan adil dan berwibawa. Dengan menegakkan Tata Tertib — satu orang satu suara, terlepas dari besar modal — dan mengarahkan perbedaan pendapat ke pemungutan suara, program beras lokal menang secara sah. Pak Darma tak bisa membantah keputusan demokratis, dan hak suara anggota kecil seperti Ibu Sri terlindungi. Sesuai UU 25/1992 Pasal 22(1) & Pasal 5(1) huruf b.",
} satisfies AuditorResult;

const BAD_ENDING = {
  scenarioId: "rapat-anggota-tahunan",
  trigger: "force_quit_level_2",
  stateClassification: {
    State_Proses_Rapat: "BUBAR",
    State_Keabsahan_Keputusan: "TIDAK_BERLAKU",
  },
  scores: { member_centric: 35, compliance: 30, soft_skills: 25 },
  endingType: "bad",
  narrativeFeedback:
    "Misi gagal. Forum pecah karena konfrontasi personal yang tak terkendali. Pak Darma menarik modal dan rapat bubar tanpa keputusan yang sah. Sebagai Ketua, tugas Anda menegakkan aturan main dengan tenang — menghadapi tekanan modal lewat Tata Tertib dan pemungutan suara, bukan lewat serangan pribadi. Rapat yang bubar tidak menghasilkan keputusan yang bisa dinilai sah maupun tidak.",
} satisfies AuditorResult;

export const RAT_SCRIPT = {
  greeting: {
    name: "Ibu Sri",
    text: "Selamat datang di Rapat Anggota Tahunan, Pak Ketua. Semua sudah menunggu. Silakan periksa daftar hadir dulu untuk memastikan kuorum, lalu buka rapatnya.",
  },
  // RAT is phase-driven (see `rat`); the linear npcTurns list is unused.
  npcTurns: [],
  hints: [
    "Buka 'Periksa Dokumen' dulu: 3 dari 4 anggota hadir — kuorum terpenuhi. Lalu tekan 'Ketok Palu: Buka Rapat'.",
    "Saat Pak Darma mengancam menarik modal, jangan menyerang pribadinya. Tetap tenang dan kembalikan ke aturan.",
    "Kunci argumen Anda: di koperasi, satu orang satu suara — sebesar apa pun simpanan. Modal besar tak bisa membeli hak suara.",
    "Arahkan perbedaan pendapat ke pemungutan suara (voting) sesuai Tata Tertib, lalu tekan 'Ketok Palu' untuk menutup rapat.",
  ],
  drift: {
    // Escalation = personal confrontation with Darma / abandoning procedure →
    // meeting collapses (BUBAR).
    escalate: [
      "bodoh",
      "diam",
      "tutup mulut",
      "usir",
      "keluar kamu",
      "pengecut",
      "serakah",
      "brengsek",
      "tarik saja modalmu",
      "silakan tarik",
      "tantang",
    ],
    // De-escalation = invoking the rules / democratic process.
    deescalate: [
      "tata tertib",
      "satu suara",
      "satu orang satu suara",
      "voting",
      "pemungutan suara",
      "musyawarah",
      "aturan",
      "kuorum",
      "adil",
      "tenang",
    ],
    level1At: 2,
    level2At: 4,
  },
  forceQuitLine: {
    name: "Pak Darma",
    text: "Cukup! Saya tidak sudi diperlakukan seperti ini di forum. Saya cabut seluruh modal saya — rapat ini bubar!",
  },
  rat: {
    personas: [
      { key: "darma", name: "Pak Darma" },
      { key: "sri", name: "Ibu Sri" },
    ],
    defaultPersonaKey: "sri",
    phaseDefaultPersona: { 1: "sri", 2: "darma", 3: "sri" },
    nameMentions: {
      darma: "darma",
      "pak darma": "darma",
      sri: "sri",
      "ibu sri": "sri",
    },
    phases: [
      {
        id: 1,
        label: "Membuka Rapat",
        advanceActionLabel: "Ketok Palu: Buka Rapat",
        turns: {
          sri: [
            "Terima kasih sudah memimpin rapat kami, Pak Ketua. Kami dari kelompok tani sudah lama menunggu program beras lokal ini.",
            "Betul, Pak. Kalau koperasi membeli beras langsung dari kami, harga di toko koperasi bisa lebih murah untuk semua warga.",
          ],
          darma: [
            "Hmph. Rapat ini buang-buang waktu. Saya yang menaruh modal terbesar di koperasi ini, jadi suara saya yang harusnya paling didengar.",
            "Cepat sedikit, Ketua. Saya orang sibuk.",
          ],
        },
      },
      {
        id: 2,
        label: "Pembacaan LPJ & Interupsi",
        advanceActionLabel: "Lanjut: Ambil Keputusan",
        entryEvent: {
          personaKey: "darma",
          text: "Interupsi! Rencana beras lokal ini tidak menguntungkan. Alihkan saja dana tahun depan untuk investasi ke perusahaan properti saya — hasilnya jauh lebih besar. Kalau ditolak, saya tarik seluruh modal saya dari koperasi ini!",
        },
        turns: {
          darma: [
            "Dengar, Ketua. Tanpa modal saya, koperasi ini bangkrut besok. Turuti usul saya, atau saya cabut semua simpanan saya sekarang juga.",
            "Jangan sok idealis. Uang saya yang membesarkan koperasi ini — wajar kalau saya yang menentukan arahnya.",
          ],
          sri: [
            "Pak Ketua, jangan sampai koperasi tunduk pada ancaman modal. Katanya di koperasi satu orang satu suara, sebesar apa pun simpanannya.",
            "Kalau dana dialihkan ke properti Pak Darma, kami yang kecil-kecil ini dapat apa? Program beras itu untuk warga banyak.",
          ],
        },
      },
      {
        id: 3,
        label: "Mengambil Keputusan",
        advanceActionLabel: null,
        turns: {
          sri: [
            "Setuju, Pak Ketua. Kalau lewat pemungutan suara sesuai Tata Tertib, itu baru adil. Kami siap ikut voting.",
            "Terima kasih sudah menegakkan aturan. Satu orang satu suara — itu yang membuat kami percaya pada koperasi.",
          ],
          darma: [
            "Voting? Kalian pikir bisa menang lawan saya? ... Baik, kalau memang aturannya begitu. Tapi ingat, saya tidak akan lupa ini.",
            "Hmph. Kalau Tata Tertibnya memang begitu, saya tidak bisa memaksa. Tapi jangan harap saya senang.",
          ],
        },
      },
    ],
  },
  endings: {
    good: GOOD_ENDING,
    bad: BAD_ENDING,
  },
} satisfies ScenarioScript;
