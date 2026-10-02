/**
 * Content for the koperasi "Papan Pengetahuan" (knowledge carousel) shown when
 * the player reads a poster near the entrance. Deliberately DIFFERENT from the
 * loading-screen trivia (koperasi-facts.ts): a mix of real SIMKOPDES dashboard
 * figures (`stat`) and program facts (`fact`). Only a selection of the dashboard
 * data is used — it's a light interlude, not the full dashboard.
 *
 * Data source (see KNOWLEDGE_SOURCE): https://simkopdes.go.id/pers/dashboard
 */

export type KnowledgeCard =
  | { kind: "stat"; value: string; label: string; group?: string; sub?: string }
  | { kind: "fact"; text: string; chip?: string };

/** Small attribution shown under the board (dashboard citation is permitted with source). */
export const KNOWLEDGE_SOURCE =
  "Sumber: Dashboard SIMKOPDES (2026), Kementerian Koperasi RI — simkopdes.go.id/pers/dashboard";

export const MADING_KNOWLEDGE_CARDS: readonly KnowledgeCard[] = [
  {
    kind: "stat",
    group: "Kesiapan Bisnis",
    value: "83.382",
    label: "Total Koperasi Desa/Kelurahan Merah Putih",
  },
  {
    kind: "fact",
    text: "NIB, NPWP, dan rekening bank adalah penanda kesiapan koperasi berbisnis secara legal dan bankable.",
  },
  {
    kind: "stat",
    group: "Kesiapan Bisnis",
    value: "60.774",
    label: "Koperasi telah memiliki NIB (Nomor Induk Berusaha)",
  },
  {
    kind: "fact",
    text: "Simpanan pokok dibayar sekali saat mendaftar, sedangkan simpanan wajib disetor rutin — keduanya membentuk modal bersama koperasi.",
  },
  {
    kind: "stat",
    group: "Modal Koperasi",
    value: "Rp 41,5 M",
    label: "Total Simpanan Pokok anggota",
    sub: "Rp 41.522.871.015",
  },
  {
    kind: "stat",
    group: "Dampak Ekonomi",
    value: "Rp 56,6 M",
    label: "Nilai Transaksi sepanjang 2026",
    sub: "Rp 56.608.918.385",
  },
  {
    kind: "fact",
    text: "Pelaksanaan RAT dipantau bertahap di SIMKOPDES: draft → dilaporkan → diverifikasi Dinas Koperasi.",
  },
  {
    kind: "stat",
    group: "Aktivitas RAT",
    value: "50.264",
    label: "Koperasi telah melaksanakan RAT",
  },

  // --- Sejarah & Prinsip Koperasi (SIM-10) ---
  // The 7 ICA principles (ICA Statement on the Co-operative Identity, 1995). Kept
  // CONSECUTIVE and self-labeled "Prinsip ke-N" so carousel nav reads them as an
  // ordered set; the `chip: "Prinsip Koperasi"` replaces the default "Tahukah Kamu?".
  {
    kind: "fact",
    chip: "Prinsip Koperasi",
    text: "Prinsip ke-1 — Keanggotaan Sukarela & Terbuka: siapa pun boleh bergabung atau keluar tanpa paksaan maupun diskriminasi.",
  },
  {
    kind: "fact",
    chip: "Prinsip Koperasi",
    text: "Prinsip ke-2 — Pengendalian Demokratis: anggota mengatur koperasi bersama; berlaku satu anggota satu suara.",
  },
  {
    kind: "fact",
    chip: "Prinsip Koperasi",
    text: "Prinsip ke-3 — Partisipasi Ekonomi Anggota: anggota menyetor modal secara adil dan berbagi SHU sesuai jasanya.",
  },
  {
    kind: "fact",
    chip: "Prinsip Koperasi",
    text: "Prinsip ke-4 — Otonomi & Kemandirian: koperasi berdiri sendiri, dikendalikan anggotanya, tanpa tunduk pada pihak luar.",
  },
  {
    kind: "fact",
    chip: "Prinsip Koperasi",
    text: "Prinsip ke-5 — Pendidikan, Pelatihan & Informasi: koperasi membekali anggota dan pengurus dengan ilmu agar koperasi maju.",
  },
  {
    kind: "fact",
    chip: "Prinsip Koperasi",
    text: "Prinsip ke-6 — Kerja Sama antar Koperasi: koperasi saling menguatkan gerakan dari tingkat lokal hingga global.",
  },
  {
    kind: "fact",
    chip: "Prinsip Koperasi",
    text: "Prinsip ke-7 — Kepedulian terhadap Komunitas: koperasi ikut membangun masyarakat sekitarnya secara berkelanjutan.",
  },
  // Landasan hukum Indonesia — asas kekeluargaan + UU yang berlaku (UU 25/1992;
  // UU 17/2012 dibatalkan MK pada 2014, Putusan No. 28/PUU-XI/2013).
  {
    kind: "fact",
    chip: "Landasan Hukum",
    text: "Di Indonesia, koperasi berpijak pada asas kekeluargaan (UUD 1945 Pasal 33) dan diatur UU No. 25 Tahun 1992 tentang Perkoperasian.",
  },
  // Sejarah singkat (default chip "Tahukah Kamu?").
  {
    kind: "fact",
    text: "Kongres Koperasi pertama digelar di Tasikmalaya, 12 Juli 1947 — tanggal itu kini diperingati sebagai Hari Koperasi Nasional.",
  },
  {
    kind: "fact",
    text: "Dalam penjelasan UU No. 25/1992, koperasi ditegaskan sebagai 'soko guru perekonomian nasional' — cita-cita yang diperjuangkan Bung Hatta.",
  },
];
