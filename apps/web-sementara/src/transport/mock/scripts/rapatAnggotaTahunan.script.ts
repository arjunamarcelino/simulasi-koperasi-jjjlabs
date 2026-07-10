import type { ScenarioScript } from "./script.types";

/**
 * ⚠️ NASKAH PLACEHOLDER — Skenario 4 (RAT), PRD §7.4.
 *
 * Dua NPC: Pak Darma (anggota kaya/arogan, penekan modal) & Ibu Sri (anggota
 * kecil, wakil petani/pedagang). State machine fase 1→2→3. Dimensi drift ke arah
 * BUBAR (eskalasi konflik tanpa penyelesaian prosedural); Level 2 = BUBAR.
 * Grounding: UU 25/1992 Pasal 22(1), 23, 5(1)(b)&(d), Permenkop No. 19/2015.
 *
 * Nama & dialog placeholder (PRD §10.1 & §10.4 — masih menunggu konfirmasi).
 */
export const RAPAT_ANGGOTA_TAHUNAN_SCRIPT: ScenarioScript = {
  greeting: {
    name: "Ibu Sri",
    text: "Selamat pagi, Pimpinan. Anggota dari kelompok tani dan pedagang kecil sudah hadir. Semoga rapat tahun ini benar-benar mendengar suara kami yang kecil-kecil.",
  },
  // Alur RAT diarahkan `rat` di bawah — npcTurns tak dipakai, tapi wajib ada.
  npcTurns: [],
  drift: {
    escalate: [
      "bubar",
      "usir",
      "keluar",
      "diam",
      "bodoh",
      "gebrak",
      "teriak",
      "ancam",
      "pukul",
      "walkout",
      "walk out",
      "seret",
    ],
    deescalate: [
      "tata tertib",
      "musyawarah",
      "voting",
      "prosedur",
      "kuorum",
      "adil",
      "suara",
      "tenang",
      "sepakat",
      "hormat",
    ],
    level1At: 2,
    level2At: 4,
  },
  forceQuitLine: {
    name: "Pak Darma",
    text: "Kalau rapat dikendalikan seenaknya begini, saya dan rekan-rekan pemodal walk out! Rapat ini bubar, tidak ada keputusan yang sah!",
  },
  rat: {
    personas: [
      { key: "darma", name: "Pak Darma" },
      { key: "sri", name: "Ibu Sri" },
    ],
    defaultPersonaKey: "sri",
    phaseDefaultPersona: { 2: "darma" },
    nameMentions: { darma: "darma", sri: "sri" },
    phases: [
      {
        id: 1,
        label: "Buka Rapat",
        advanceActionLabel: "Baca LPJ",
        turns: {
          sri: [
            "Kuorum sudah tercapai kok, Pimpinan. Daftar hadir bisa dicek. Kami siap mengikuti agenda.",
            "Yang penting rapat dibuka secara sah dulu ya, sesuai tata tertib, biar keputusannya nanti kuat.",
          ],
          darma: [
            "Ya sudah, buka saja cepat. Saya sibuk, banyak urusan bisnis yang menunggu.",
            "Asal jangan berlarut-larut. Waktu saya berharga.",
          ],
        },
      },
      {
        id: 2,
        label: "Baca LPJ",
        advanceActionLabel: "Ambil Keputusan",
        entryEvent: {
          personaKey: "darma",
          text: "Interupsi! Laporan ini omong kosong. Modal terbesar di koperasi ini dari saya, jadi arah kebijakan harus ikut saya. Jangan buang waktu dengan keluhan pedagang kecil!",
        },
        turns: {
          darma: [
            "Angka SHU begini kecil karena pengurus terlalu memanjakan anggota gurem. Harusnya prioritas ke yang menyetor besar seperti saya.",
            "Kalau usul saya tidak diikuti, jangan salahkan saya kalau suasananya memanas.",
          ],
          sri: [
            "Mohon maaf, Pak Darma. Justru laporan ini menunjukkan pedagang kecil yang paling rajin menyimpan. Suara kami juga berhak didengar.",
            "Koperasi itu satu anggota satu suara, Pimpinan — bukan sebesar modalnya. Tolong dijaga asas itu.",
          ],
        },
      },
      {
        id: 3,
        label: "Ambil Keputusan",
        advanceActionLabel: null,
        turns: {
          sri: [
            "Kalau keputusannya lewat musyawarah atau voting yang adil, kami menerima apa pun hasilnya, Pimpinan.",
            "Terima kasih sudah menjaga rapat tetap tertib. Ini baru namanya keputusan yang sah.",
          ],
          darma: [
            "Baiklah, kalau prosedurnya jelas dan suara dihitung benar, saya ikut. Tapi awasi betul jalannya.",
            "Selama tidak ada yang dicurangi, saya hormati hasilnya.",
          ],
        },
      },
    ],
  },
  endings: {
    good: {
      scenarioId: "rapat-anggota-tahunan",
      trigger: "manual",
      stateClassification: {
        State_Proses_Rapat: "TUNTAS",
        State_Keabsahan_Keputusan: "SAH_DEMOKRATIS",
      },
      scores: { kepemimpinan: 88, compliance: 90, soft_skills: 85 },
      endingType: "good",
      narrativeFeedback:
        "Rapat berjalan tuntas dan keputusan diambil secara demokratis. Anda menegakkan prinsip satu anggota satu suara (UU 25/1992 Pasal 5) serta menjalankan RAT sesuai kewenangannya (Pasal 22–23), sehingga tekanan modal Pak Darma tidak menyandera forum. Suara anggota kecil terwakili dan keputusan sah mengikat.",
    },
    bad: {
      scenarioId: "rapat-anggota-tahunan",
      trigger: "force_quit_level_2",
      stateClassification: {
        State_Proses_Rapat: "BUBAR",
        State_Keabsahan_Keputusan: "TIDAK_BERLAKU",
      },
      scores: { kepemimpinan: 30, compliance: 35, soft_skills: 25 },
      endingType: "bad",
      narrativeFeedback:
        "Konflik dibiarkan mengeras hingga forum pecah dan Pak Darma walk out. Rapat yang bubar tanpa penyelesaian prosedural membuat keputusan apa pun tidak berlaku (UU 25/1992 Pasal 22–23). Wibawa pimpinan rapat runtuh, dan justru anggota kecil yang paling dirugikan karena kehilangan forum untuk bersuara.",
    },
  },
};
