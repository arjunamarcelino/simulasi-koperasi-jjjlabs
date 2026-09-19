-- GENERATED FILE — do not edit by hand.
-- Source: apps/db/catalog/*.json  •  Regenerate: pnpm --filter @simkop/db gen:seed
-- Catalog rows mirror apps/web/src/content/* exactly (parity enforced in CI).

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

-- Missions (7) — redeem_code is a server-side secret (reallife only)
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
