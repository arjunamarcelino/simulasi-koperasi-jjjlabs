/**
 * Quiz koperasi — bank of 20 questions; each play picks 10 at random.
 * Multiple choice, exactly one correct option (correctIndex). `explanation` is
 * optional and shown after the answer is revealed. All content is placeholder /
 * educational — edit freely.
 */

export type QuizQuestion = {
  id: string;
  question: string;
  options: readonly string[];
  correctIndex: number;
  explanation?: string;
};

/** How many questions to draw per play, and reward tuning. */
export const QUIZ_PICK = 10;
export const POINT_PER_CORRECT = 10;
export const XP_PER_QUESTION = 10;

export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  {
    id: "q01",
    question: "Apa kepanjangan dari RAT dalam koperasi?",
    options: ["Rapat Anggota Tahunan", "Rencana Anggaran Tahunan", "Rapat Antar Tim", "Rekap Aset Tahunan"],
    correctIndex: 0,
    explanation: "RAT (Rapat Anggota Tahunan) adalah forum pengambilan keputusan tertinggi koperasi.",
  },
  {
    id: "q02",
    question: "Siapa yang dikenal sebagai Bapak Koperasi Indonesia?",
    options: ["Soekarno", "Mohammad Hatta", "Ki Hajar Dewantara", "R. Aria Wiriaatmaja"],
    correctIndex: 1,
    explanation: "Mohammad Hatta dijuluki Bapak Koperasi Indonesia.",
  },
  {
    id: "q03",
    question: "Prinsip pengambilan keputusan dalam koperasi adalah…",
    options: ["Satu saham satu suara", "Satu anggota satu suara", "Suara sesuai modal", "Suara pengurus saja"],
    correctIndex: 1,
    explanation: "Koperasi menganut 'satu anggota, satu suara' — demokratis, bukan berdasar besar modal.",
  },
  {
    id: "q04",
    question: "Hari Koperasi Nasional diperingati setiap tanggal…",
    options: ["17 Agustus", "1 Juni", "12 Juli", "28 Oktober"],
    correctIndex: 2,
    explanation: "Hari Koperasi Nasional jatuh pada 12 Juli.",
  },
  {
    id: "q05",
    question: "SHU dalam koperasi adalah singkatan dari…",
    options: ["Sisa Hasil Usaha", "Simpanan Harta Utama", "Surat Hak Usaha", "Saldo Harian Umum"],
    correctIndex: 0,
    explanation: "SHU (Sisa Hasil Usaha) dibagi berdasarkan jasa & partisipasi anggota.",
  },
  {
    id: "q06",
    question: "Landasan koperasi dalam UUD 1945 terdapat pada pasal…",
    options: ["Pasal 27", "Pasal 31", "Pasal 33", "Pasal 34"],
    correctIndex: 2,
    explanation: "Pasal 33 UUD 1945 menegaskan perekonomian disusun atas asas kekeluargaan.",
  },
  {
    id: "q07",
    question: "Simpanan yang dibayar sekali saat mendaftar menjadi anggota disebut…",
    options: ["Simpanan wajib", "Simpanan pokok", "Simpanan sukarela", "Simpanan berjangka"],
    correctIndex: 1,
    explanation: "Simpanan pokok dibayar sekali saat masuk; simpanan wajib dibayar rutin.",
  },
  {
    id: "q08",
    question: "NIB yang wajib dimiliki koperasi adalah singkatan dari…",
    options: ["Nomor Induk Berusaha", "Nomor Izin Bank", "Nota Induk Bisnis", "Nomor Identitas Badan"],
    correctIndex: 0,
    explanation: "NIB (Nomor Induk Berusaha) adalah identitas legal agar koperasi berusaha resmi.",
  },
  {
    id: "q09",
    question: "Kekuasaan tertinggi dalam koperasi berada di tangan…",
    options: ["Ketua", "Pengurus", "Rapat Anggota", "Pengawas"],
    correctIndex: 2,
    explanation: "Rapat Anggota adalah pemegang kekuasaan tertinggi koperasi.",
  },
  {
    id: "q10",
    question: "Koperasi berasaskan…",
    options: ["Kekeluargaan", "Persaingan bebas", "Individualisme", "Monopoli"],
    correctIndex: 0,
    explanation: "Asas koperasi adalah kekeluargaan.",
  },
  {
    id: "q11",
    question: "Program Koperasi Desa/Kelurahan Merah Putih bertujuan utama untuk…",
    options: ["Menambah pajak desa", "Memperkuat ekonomi desa", "Menggantikan bank", "Mengurangi jumlah koperasi"],
    correctIndex: 1,
    explanation: "Program ini memperkuat ekonomi desa dan memangkas rantai tengkulak.",
  },
  {
    id: "q12",
    question: "Yang BUKAN termasuk perangkat organisasi koperasi adalah…",
    options: ["Rapat Anggota", "Pengurus", "Pengawas", "Dewan Komisaris"],
    correctIndex: 3,
    explanation: "Perangkat koperasi: Rapat Anggota, Pengurus, dan Pengawas. Dewan Komisaris ada di PT.",
  },
  {
    id: "q13",
    question: "Modal koperasi yang berasal dari anggota disebut modal…",
    options: ["Pinjaman", "Sendiri", "Asing", "Ventura"],
    correctIndex: 1,
    explanation: "Simpanan pokok, wajib, dan sukarela anggota membentuk modal sendiri koperasi.",
  },
  {
    id: "q14",
    question: "Koperasi yang menjalankan lebih dari satu jenis usaha disebut koperasi…",
    options: ["Tunggal usaha", "Serba usaha", "Primer", "Sekunder"],
    correctIndex: 1,
    explanation: "Koperasi serba usaha menjalankan beberapa unit usaha sekaligus.",
  },
  {
    id: "q15",
    question: "Salah satu contoh unit usaha Koperasi Desa Merah Putih adalah…",
    options: ["Bursa saham", "Simpan pinjam", "Kasino", "Ekspor senjata"],
    correctIndex: 1,
    explanation: "Unit usahanya a.l. sembako, simpan pinjam, apotek/klinik desa, gudang & logistik.",
  },
  {
    id: "q16",
    question: "Pembagian SHU kepada anggota didasarkan pada…",
    options: ["Besarnya modal saja", "Jasa & partisipasi anggota", "Undian", "Lama menjadi anggota saja"],
    correctIndex: 1,
    explanation: "SHU dibagi menurut jasa dan partisipasi, bukan sekadar besar modal.",
  },
  {
    id: "q17",
    question: "Koperasi pertama di Indonesia didirikan di kota…",
    options: ["Jakarta", "Purwokerto", "Surabaya", "Yogyakarta"],
    correctIndex: 1,
    explanation: "R. Aria Wiriaatmaja mendirikan koperasi pertama di Purwokerto (1895).",
  },
  {
    id: "q18",
    question: "Pengawas dalam koperasi bertugas untuk…",
    options: ["Menjalankan usaha harian", "Mengawasi pengurus", "Menetapkan harga", "Menyimpan uang"],
    correctIndex: 1,
    explanation: "Pengawas mengawasi pelaksanaan tugas pengurus.",
  },
  {
    id: "q19",
    question: "Keanggotaan koperasi bersifat…",
    options: ["Wajib bagi semua warga", "Sukarela dan terbuka", "Turun-temurun", "Hanya untuk pengurus"],
    correctIndex: 1,
    explanation: "Salah satu prinsip koperasi: keanggotaan sukarela dan terbuka.",
  },
  {
    id: "q20",
    question: "Laporan pertanggungjawaban pengurus disampaikan kepada anggota melalui…",
    options: ["Media sosial", "RAT", "Surat kabar", "Rapat pengawas"],
    correctIndex: 1,
    explanation: "Pengurus mempertanggungjawabkan kinerjanya dalam RAT.",
  },
];

// Dev-only: catch a mistyped correctIndex before it ships (stripped from prod).
if (import.meta.env.DEV) {
  for (const q of QUIZ_QUESTIONS) {
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`Quiz "${q.id}": correctIndex ${q.correctIndex} out of range`);
    }
  }
}
