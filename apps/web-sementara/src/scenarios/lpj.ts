/**
 * Ringkasan LPJ & Rencana Kerja — Skenario 4 (RAT), data statis FE.
 *
 * Ditampilkan saat fase "Baca LPJ" / "Ambil Keputusan" agar pemain membaca dan
 * memahami isi laporan sebelum memutuskan — bukan sekadar menekan tombol. Isinya
 * di-jaga KONSISTEN dengan prompt NPC backend (rencana kerja beras lokal, kuorum
 * 3 dari 4, prinsip satu anggota satu suara).
 */
export type LpjSection = { heading: string; body: string };

export const RAT_LPJ_SUMMARY: {
  title: string;
  sections: readonly LpjSection[];
} = {
  title: "Ringkasan LPJ & Rencana Kerja",
  sections: [
    {
      heading: "Kehadiran & Kuorum",
      body: "4 anggota terdaftar, 3 hadir — kuorum (>50%) terpenuhi, rapat sah untuk dibuka.",
    },
    {
      heading: "Laporan Tahun Lalu",
      body: "Kegiatan koperasi berjalan sehat. Sisa Hasil Usaha (SHU) dibagikan kepada anggota sesuai jasa usaha masing-masing — bukan menurut besar modal.",
    },
    {
      heading: "Rencana Kerja Tahun Depan",
      body: "Usulan pengurus: koperasi membeli beras langsung dari kelompok tani lokal, agar harga jual di toko koperasi lebih murah untuk anggota dan warga.",
    },
    {
      heading: "Usulan Tandingan di Forum",
      body: "Mengalihkan dana rencana kerja untuk investasi properti milik anggota bermodal besar. Inilah yang memicu perdebatan di rapat.",
    },
    {
      heading: "Keputusan yang Diminta",
      body: "Menetapkan arah rencana kerja tahun depan. Sesuai Tata Tertib, keputusan diambil dengan prinsip satu anggota satu suara — lewat musyawarah, dan bila perlu pemungutan suara.",
    },
  ],
};
