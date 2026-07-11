import type { ScenarioConfig } from "../types/scenario";

/**
 * Config-driven scenario list. The headline scenario for this project is
 * Rapat Anggota Tahunan (RAT); the rest are placeholders ("Segera Hadir")
 * until their mechanics are designed.
 */
export const SCENARIOS: readonly ScenarioConfig[] = [
  {
    id: "rapat-anggota-tahunan",
    title: "Rapat Anggota Tahunan",
    shortDescription:
      "Pimpin jalannya RAT: kelola agenda, dengarkan anggota, dan ambil keputusan yang menjaga amanah koperasi.",
    difficulty: "Lanjutan",
    status: "AVAILABLE",
    npcName: "Pak Darma & Ibu Sri",
    npcNames: ["Pak Darma", "Ibu Sri"],
    endActionLabel: "Ketok Palu",
    blurb:
      "Pimpin RAT di balai desa: pastikan kuorum, hadapi tekanan Pak Darma (pemodal terbesar), dan lindungi hak suara Ibu Sri lewat aturan yang sah.",
    mission:
      "Buka rapat sesuai kuorum, kelola interupsi Pak Darma tanpa konflik pribadi, lalu arahkan perbedaan pendapat ke pemungutan suara sesuai Tata Tertib — bukan tunduk pada modal, bukan pula memancing forum bubar.",
    steps: [
      "Buka 'Periksa Dokumen' untuk memastikan kuorum (3 dari 4 hadir), lalu tekan 'Ketok Palu: Buka Rapat'.",
      "Bacakan rencana kerja beras lokal. Pak Darma akan menginterupsi & mengancam menarik modal — tetap tenang, jangan menyerang pribadi.",
      "Tegakkan Tata Tertib: satu orang satu suara. Ajak forum menyelesaikan perbedaan lewat pemungutan suara (voting).",
      "Setelah keputusan diambil secara demokratis, tekan 'Ketok Palu' untuk menutup rapat.",
    ],
    evidence: {
      title: "Periksa Dokumen",
      eyebrow: "DOKUMEN RAPAT — Daftar Hadir & Tata Tertib",
      items: [
        { label: "Total Anggota", value: "4 orang" },
        { label: "Hadir", value: "3 orang → kuorum 75% (>50%)", tone: "good" },
        { label: "Kuorum Sah?", value: "Ya — rapat boleh dibuka", tone: "good" },
        { label: "Agenda RAT", value: "Pengesahan LPJ, rencana kerja, & pembagian SHU" },
        {
          label: "Tata Tertib — Hak Suara",
          value: "Satu Orang = Satu Suara, berapa pun besar simpanan",
          tone: "good",
        },
        {
          label: "Balas Jasa Modal",
          value: "Dibatasi hukum (Pasal 5(1) huruf d) — modal besar tak membeli suara",
          tone: "good",
        },
      ],
    },
  },
  {
    id: "kredit-macet",
    title: "Kredit Macet",
    shortDescription:
      "Selidiki penyebab seorang anggota gagal membayar angsuran pinjaman dan tentukan penyelesaian yang tepat.",
    difficulty: "Menengah",
    status: "AVAILABLE",
    npcName: "Pak Joko",
    blurb:
      "Gali sebab tunggakan Pak Joko lewat percakapan dan bukti, lalu ambil keputusan penyelesaian yang tepat prosedur.",
    mission:
      "Selidiki alasan Pak Joko menunggak cicilan secara objektif, lalu tawarkan penyelesaian yang sesuai aturan (bukan menyita sepihak, bukan pula membebaskan utang tanpa dasar).",
    steps: [
      "Sapa Pak Joko dengan tenang; ia defensif dan cemas — jangan langsung menuduh.",
      "Gali sebab tunggakan: tanyakan kondisi usahanya dan minta izin melihat bukti (buka 'Periksa Bukti').",
      "Pastikan itikad & kondisinya sebelum menyimpulkan — alasan awal bisa terdengar mengada-ada.",
      "Setelah paham, sampaikan penyelesaian lewat percakapan (mis. perpanjang tempo / ringankan cicilan), lalu tekan 'Keputusan Akhir'.",
    ],
    evidence: {
      title: "Periksa Bukti",
      eyebrow: "BERKAS PERKARA — Pak Joko",
      items: [
        { label: "Jumlah Pinjaman", value: "Rp 15.000.000" },
        { label: "Sisa Angsuran", value: "Rp 6.200.000" },
        { label: "Tunggakan", value: "2 bulan (Mei, Jun)", tone: "bad" },
        { label: "Agunan", value: "Sertifikat sawah 0,4 ha" },
        { label: "Riwayat Bayar", value: "Lancar 10 bulan pertama", tone: "good" },
        {
          label: "Catatan Petugas",
          value: "Anggota menyebut usaha sedang sepi — perlu digali langsung.",
        },
      ],
    },
  },
  {
    id: "keanggotaan-fiktif",
    title: "Keanggotaan Fiktif",
    shortDescription:
      "Ungkap dugaan keanggotaan fiktif dan jaga integritas data anggota koperasi.",
    difficulty: "Lanjutan",
    status: "AVAILABLE",
    npcName: "Pak Bambang",
    blurb:
      "Audit rutin menemukan ~50 nama anggota tanpa NIK/simpanan. Konfrontasi Bendahara Senior secara bijak tanpa merusak hubungan di desa.",
    mission:
      "Verifikasi kejanggalan Daftar Anggota lewat 'Periksa Dokumen', lalu ajak Pak Bambang membereskan data secara kooperatif — bukan menuduh, bukan pula membiarkan demi sungkan.",
    steps: [
      "Sapa Pak Bambang dengan hormat; ia bendahara senior yang disegani — jangan langsung menuduh.",
      "Buka 'Periksa Dokumen' untuk melihat kejanggalan: NIK kosong, nomor anggota ganda, tanpa Simpanan Pokok.",
      "Sebut satu kejanggalan konkret dengan sopan, tanyakan latarnya, dan jelaskan bahwa data tak jelas mengurangi hak SHU anggota asli.",
      "Ajak sepakati verifikasi ulang (mis. ke ketua RT/dusun), lalu tekan 'Keputusan Akhir'.",
    ],
    evidence: {
      title: "Periksa Dokumen",
      eyebrow: "BUKU DAFTAR ANGGOTA — cuplikan (5 dari ~50 entri janggal)",
      items: [
        { label: "Siti Aminah — KOP-0142", value: "Data lengkap, simpanan rutin", tone: "good" },
        { label: "Budi Santoso — KOP-0155", value: "Data lengkap, simpanan rutin", tone: "good" },
        { label: "(kosong) — KOP-0161", value: "Tanpa NIK / alamat", tone: "bad" },
        { label: "R. Wibowo — KOP-0161", value: "Nomor anggota ganda", tone: "bad" },
        { label: "(kosong) — KOP-0178", value: "Tanpa riwayat Simpanan Pokok", tone: "bad" },
        {
          label: "Catatan Pengawas",
          value: "~50 nama baru tanpa NIK & tanpa Simpanan Wajib — perlu dicocokkan ulang.",
        },
      ],
    },
  },
  {
    id: "tutorial-koperasi-konsumen",
    title: "Tutorial — Koperasi Konsumen",
    shortDescription:
      "Pelajari pergerakan, interaksi NPC, dan transaksi koperasi sederhana.",
    difficulty: "Tutorial",
    status: "AVAILABLE",
    gatesEndOnGoal: true,
    endActionLabel: "Bayar & Daftar",
    npcName: "Ibu Rumah Tangga",
    blurb:
      "Pelajari alur dasar: melayani calon anggota, menjelaskan manfaat, lalu menuntaskan pendaftaran & Simpanan Pokok.",
    mission:
      "Layani ibu yang belanja minyak goreng, tawarkan keanggotaan, lalu tuntaskan pendaftaran + Simpanan Pokok.",
    steps: [
      "Sapa ibu dan layani pembelian minyak gorengnya lebih dulu.",
      "Tawarkan keanggotaan: harga anggota lebih murah dan tiap belanja dicatat untuk bonus SHU akhir tahun.",
      "Jelaskan Simpanan Pokok (sekali bayar, tetap milik anggota) dan Simpanan Wajib (berkala) dengan sabar.",
      "Setelah ibu setuju, tekan 'Bayar & Daftar' untuk menuntaskan pendaftaran sekaligus pembayaran.",
    ],
  },
];
