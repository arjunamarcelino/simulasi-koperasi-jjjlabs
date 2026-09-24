-- GENERATED FILE — do not edit by hand.
-- Source: @simkop/catalog (packages/catalog)  •  Regenerate: pnpm --filter @simkop/db gen:seed
-- apps/web imports the same catalog, so seed and UI cannot drift (parity checked in CI).

-- Scenarios (4)
insert into public.scenario_definition (code, title, difficulty, status, sort_order) values
  ('rapat-anggota-tahunan', 'Rapat Anggota Tahunan', 'Lanjutan', 'AVAILABLE', 1),
  ('kredit-macet', 'Kredit Macet', 'Menengah', 'AVAILABLE', 2),
  ('keanggotaan-fiktif', 'Keanggotaan Fiktif', 'Lanjutan', 'AVAILABLE', 3),
  ('tutorial-koperasi-konsumen', 'Tutorial — Koperasi Konsumen', 'Tutorial', 'AVAILABLE', 4)
on conflict (code) do update set
  title = excluded.title,
  difficulty = excluded.difficulty,
  status = excluded.status,
  sort_order = excluded.sort_order;

-- Missions (7) — redeem_code is a soft KDMP gate code (reallife only), not a cryptographic secret
insert into public.mission_definition (code, kind, title, description, reward_xp, reward_point, redeem_code, sort_order) values
  ('main-kuis', 'game', 'Main Kuis Koperasi', 'Selesaikan satu sesi kuis koperasi di komputer KUIS.', 20, 20, NULL, 1),
  ('baca-mading', 'game', 'Baca Papan Pengetahuan', 'Buka papan pengetahuan di mading dekat pintu masuk.', 15, 10, NULL, 2),
  ('tukar-voucher', 'game', 'Tukar Satu Voucher', 'Tukar satu voucher dengan poin di kasir.', 15, 15, NULL, 3),
  ('keliling', 'game', 'Kelilingi Interior Koperasi', 'Masuk dan jelajahi seluruh ruangan koperasi.', 10, 10, NULL, 4),
  ('kunjungi-kdmp', 'reallife', 'Kunjungi KDMP', 'Kunjungi satu Koperasi Desa Merah Putih terdekat, lalu masukkan kode yang tertera di sana.', 50, 100, 'KDMP2026', 5),
  ('impact-umkm', 'reallife', 'Koperasi Impact Mission', 'Cari satu produk UMKM lokal dan beli melalui koperasi, lalu masukkan kode dari struk.', 60, 120, 'UMKM2026', 6),
  ('ajak-anggota', 'reallife', 'Ajak Anggota Baru', 'Ajak satu orang mendaftar menjadi anggota koperasi, lalu masukkan kode konfirmasi.', 40, 80, 'ANGGOTA2026', 7)
on conflict (code) do update set
  kind = excluded.kind,
  title = excluded.title,
  description = excluded.description,
  reward_xp = excluded.reward_xp,
  reward_point = excluded.reward_point,
  redeem_code = excluded.redeem_code,
  sort_order = excluded.sort_order;

-- Vouchers (5)
insert into public.voucher_definition (code, name, cost, description, sort_order) values
  ('belanja-5k', 'Voucher Belanja KDMP Rp5.000', 50, 'Potongan belanja di toko koperasi', 1),
  ('belanja-10k', 'Voucher Belanja KDMP Rp10.000', 100, 'Potongan belanja di toko koperasi', 2),
  ('pulsa-5k', 'Voucher Pulsa Rp5.000', 60, 'Isi ulang pulsa semua operator', 3),
  ('sembako', 'Paket Sembako Hemat', 150, 'Beras 1kg + minyak + gula', 4),
  ('simpan-pinjam', 'Diskon Biaya Simpan Pinjam', 200, 'Potongan administrasi pinjaman berikutnya', 5)
on conflict (code) do update set
  name = excluded.name,
  cost = excluded.cost,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- Badges (9) — criteria mirrors BadgeCriteria; null = teaser (locked until its signal exists)
insert into public.badge_definition (code, title, requirement, icon, criteria, sort_order) values
  ('anggota-aktif', 'Anggota Aktif', 'Capai Level 3', 'medal', '{"kind":"level","min":3}'::jsonb, 1),
  ('rajin-kuis', 'Rajin Kuis', 'Selesaikan kuis', 'book', '{"kind":"missionDone","missionId":"main-kuis"}'::jsonb, 2),
  ('kolektor-voucher', 'Kolektor Voucher', 'Tukar 1 voucher', 'ticket', '{"kind":"voucherCount","min":1}'::jsonb, 3),
  ('penjelajah', 'Penjelajah', 'Jelajahi koperasi', 'compass', '{"kind":"missionDone","missionId":"keliling"}'::jsonb, 4),
  ('hartawan', 'Hartawan', 'Kumpulkan 100 poin', 'coin', '{"kind":"point","min":100}'::jsonb, 5),
  ('misi-perdana', 'Misi Perdana', 'Selesaikan 1 misi', 'flag', '{"kind":"missionCount","min":1}'::jsonb, 6),
  ('juara-rat', 'Juara RAT', 'Belum tersedia', 'trophy', NULL, 7),
  ('simpanan-rutin', 'Simpanan Rutin', 'Belum tersedia', 'piggy', NULL, 8),
  ('pinjaman-lancar', 'Pinjaman Lancar', 'Belum tersedia', 'check', NULL, 9)
on conflict (code) do update set
  title = excluded.title,
  requirement = excluded.requirement,
  icon = excluded.icon,
  criteria = excluded.criteria,
  sort_order = excluded.sort_order;

-- Quiz (20) — correct_index is the answer key; base table is not client-readable (quiz_catalog omits it)
insert into public.quiz_definition (code, prompt, options, correct_index, explanation, sort_order) values
  ('q01', 'Apa kepanjangan dari RAT dalam koperasi?', '["Rapat Anggota Tahunan","Rencana Anggaran Tahunan","Rapat Antar Tim","Rekap Aset Tahunan"]'::jsonb, 0, 'RAT (Rapat Anggota Tahunan) adalah forum pengambilan keputusan tertinggi koperasi.', 1),
  ('q02', 'Siapa yang dikenal sebagai Bapak Koperasi Indonesia?', '["Soekarno","Mohammad Hatta","Ki Hajar Dewantara","R. Aria Wiriaatmaja"]'::jsonb, 1, 'Mohammad Hatta dijuluki Bapak Koperasi Indonesia.', 2),
  ('q03', 'Prinsip pengambilan keputusan dalam koperasi adalah…', '["Satu saham satu suara","Satu anggota satu suara","Suara sesuai modal","Suara pengurus saja"]'::jsonb, 1, 'Koperasi menganut ''satu anggota, satu suara'' — demokratis, bukan berdasar besar modal.', 3),
  ('q04', 'Hari Koperasi Nasional diperingati setiap tanggal…', '["17 Agustus","1 Juni","12 Juli","28 Oktober"]'::jsonb, 2, 'Hari Koperasi Nasional jatuh pada 12 Juli.', 4),
  ('q05', 'SHU dalam koperasi adalah singkatan dari…', '["Sisa Hasil Usaha","Simpanan Harta Utama","Surat Hak Usaha","Saldo Harian Umum"]'::jsonb, 0, 'SHU (Sisa Hasil Usaha) dibagi berdasarkan jasa & partisipasi anggota.', 5),
  ('q06', 'Landasan koperasi dalam UUD 1945 terdapat pada pasal…', '["Pasal 27","Pasal 31","Pasal 33","Pasal 34"]'::jsonb, 2, 'Pasal 33 UUD 1945 menegaskan perekonomian disusun atas asas kekeluargaan.', 6),
  ('q07', 'Simpanan yang dibayar sekali saat mendaftar menjadi anggota disebut…', '["Simpanan wajib","Simpanan pokok","Simpanan sukarela","Simpanan berjangka"]'::jsonb, 1, 'Simpanan pokok dibayar sekali saat masuk; simpanan wajib dibayar rutin.', 7),
  ('q08', 'NIB yang wajib dimiliki koperasi adalah singkatan dari…', '["Nomor Induk Berusaha","Nomor Izin Bank","Nota Induk Bisnis","Nomor Identitas Badan"]'::jsonb, 0, 'NIB (Nomor Induk Berusaha) adalah identitas legal agar koperasi berusaha resmi.', 8),
  ('q09', 'Kekuasaan tertinggi dalam koperasi berada di tangan…', '["Ketua","Pengurus","Rapat Anggota","Pengawas"]'::jsonb, 2, 'Rapat Anggota adalah pemegang kekuasaan tertinggi koperasi.', 9),
  ('q10', 'Koperasi berasaskan…', '["Kekeluargaan","Persaingan bebas","Individualisme","Monopoli"]'::jsonb, 0, 'Asas koperasi adalah kekeluargaan.', 10),
  ('q11', 'Program Koperasi Desa/Kelurahan Merah Putih bertujuan utama untuk…', '["Menambah pajak desa","Memperkuat ekonomi desa","Menggantikan bank","Mengurangi jumlah koperasi"]'::jsonb, 1, 'Program ini memperkuat ekonomi desa dan memangkas rantai tengkulak.', 11),
  ('q12', 'Yang BUKAN termasuk perangkat organisasi koperasi adalah…', '["Rapat Anggota","Pengurus","Pengawas","Dewan Komisaris"]'::jsonb, 3, 'Perangkat koperasi: Rapat Anggota, Pengurus, dan Pengawas. Dewan Komisaris ada di PT.', 12),
  ('q13', 'Modal koperasi yang berasal dari anggota disebut modal…', '["Pinjaman","Sendiri","Asing","Ventura"]'::jsonb, 1, 'Simpanan pokok, wajib, dan sukarela anggota membentuk modal sendiri koperasi.', 13),
  ('q14', 'Koperasi yang menjalankan lebih dari satu jenis usaha disebut koperasi…', '["Tunggal usaha","Serba usaha","Primer","Sekunder"]'::jsonb, 1, 'Koperasi serba usaha menjalankan beberapa unit usaha sekaligus.', 14),
  ('q15', 'Salah satu contoh unit usaha Koperasi Desa Merah Putih adalah…', '["Bursa saham","Simpan pinjam","Kasino","Ekspor senjata"]'::jsonb, 1, 'Unit usahanya a.l. sembako, simpan pinjam, apotek/klinik desa, gudang & logistik.', 15),
  ('q16', 'Pembagian SHU kepada anggota didasarkan pada…', '["Besarnya modal saja","Jasa & partisipasi anggota","Undian","Lama menjadi anggota saja"]'::jsonb, 1, 'SHU dibagi menurut jasa dan partisipasi, bukan sekadar besar modal.', 16),
  ('q17', 'Koperasi pertama di Indonesia didirikan di kota…', '["Jakarta","Purwokerto","Surabaya","Yogyakarta"]'::jsonb, 1, 'R. Aria Wiriaatmaja mendirikan koperasi pertama di Purwokerto (1895).', 17),
  ('q18', 'Pengawas dalam koperasi bertugas untuk…', '["Menjalankan usaha harian","Mengawasi pengurus","Menetapkan harga","Menyimpan uang"]'::jsonb, 1, 'Pengawas mengawasi pelaksanaan tugas pengurus.', 18),
  ('q19', 'Keanggotaan koperasi bersifat…', '["Wajib bagi semua warga","Sukarela dan terbuka","Turun-temurun","Hanya untuk pengurus"]'::jsonb, 1, 'Salah satu prinsip koperasi: keanggotaan sukarela dan terbuka.', 19),
  ('q20', 'Laporan pertanggungjawaban pengurus disampaikan kepada anggota melalui…', '["Media sosial","RAT","Surat kabar","Rapat pengawas"]'::jsonb, 1, 'Pengurus mempertanggungjawabkan kinerjanya dalam RAT.', 20)
on conflict (code) do update set
  prompt = excluded.prompt,
  options = excluded.options,
  correct_index = excluded.correct_index,
  explanation = excluded.explanation,
  sort_order = excluded.sort_order;
