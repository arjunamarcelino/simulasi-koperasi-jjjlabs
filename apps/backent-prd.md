# PRD — Backend & AI Pipeline
## Koperasi Simulator — Hackathon Digital Cooperatives Expo 2026

**Versi:** 1.1 (memperbarui model penyelesaian sesi — lihat "Perubahan dari v1.0" di bawah)
**Status:** Draf untuk didiskusikan tim — berisi beberapa asumsi eksplisit yang perlu dikonfirmasi (lihat Bagian 10)

**Perubahan dari v1.0:**
- Bagian 6 diperluas: model state kini tiga lapis (nada real-time via prompting → level drift via observer asinkron → klasifikasi formal post-hoc), bukan dua lapis.
- Mekanisme "kondisi tersembunyi" yang sebelumnya stretch goal kini dikonkretkan sebagai level drift dengan tiga jalur penyelesaian sesi (manual, sinyal, force quit) — lihat Bagian 6 & 7.
- Bagian 9 menambahkan kebutuhan publikasi level drift real-time ke FE untuk indikator ketegangan dalam game.

---

## 1. Ringkasan & Ruang Lingkup

Dokumen ini mendefinisikan arsitektur backend dan AI pipeline untuk Koperasi Simulator: game edukasi berbasis Generative AI yang mensimulasikan empat skenario tata kelola koperasi. Cakupan dokumen ini:

- Arsitektur sistem (server token, voice worker, AI Auditor)
- Model klasifikasi state (hybrid real-time + observer + post-hoc)
- Alur teknis tiap skenario, sinyal penanda selesai, dan taksonomi state
- Desain AI Auditor lintas-skenario
- Tech stack dan struktur direktori

**Di luar cakupan** (akan disusun terpisah): skema detail REST endpoint & payload event LiveKit data channel (dokumen kontrak tersendiri, disusun setelah PRD ini disepakati); implementasi visual FE game (tilemap, sprite, dsb — domain tim FE); konten naratif final untuk setiap kemungkinan ending (lihat catatan di Bagian 7); bentuk UI persis dari indikator ketegangan (keputusan tim FE, lihat Bagian 9).

---

## 2. Prinsip Arsitektur Kunci

Keputusan-keputusan berikut berlaku lintas seluruh skenario:

1. **Satu proses `voice_agent.py` menangani seluruh skenario dan seluruh persona NPC**, termasuk dua-NPC simultan di Skenario 4 (RAT), lewat pola `llm_node`/`tts_node` override per persona yang sudah tervalidasi — bukan proses terpisah per bot.
2. **Satu room LiveKit per sesi skenario.** Pemain memulai skenario baru = request token baru dengan `scenario_id` = join room baru. Tidak ada room berkelanjutan lintas skenario. Alasan lengkap ada di Bagian 5.
3. **Model state berlapis tiga**: (1) nada/sikap NPC berevolusi alami di real-time murni lewat kualitas system prompt + ChatContext, tanpa state-tracking eksplisit; (2) level drift (khusus arah negatif/menyimpang) dilacak via observer asinkron yang berjalan paralel — tidak menghambat respons suara — dipakai untuk indikator ketegangan di FE dan pemicu penyelesaian sesi; (3) klasifikasi state formal & skor dilakukan post-hoc oleh AI Auditor (`gpt-5.4`) membaca transkrip penuh begitu sesi berakhir lewat jalur mana pun. Detail lengkap di Bagian 6.
4. **Voice sebagai input utama, teks sebagai fallback** — tidak mengubah desain backend; keduanya masuk lewat jalur yang sama begitu sampai di `voice_agent.py` (STT untuk voice, langsung sebagai teks untuk fallback).
5. **Tidak ada persistensi database.** Seluruh state sesi (fase, riwayat percakapan, level drift, hasil skor) bersifat in-memory/ephemeral, hidup selama room LiveKit aktif, dan tidak perlu disimpan setelah sesi berakhir. Ini menghilangkan kebutuhan lapisan database sama sekali untuk MVP ini.
6. **Tiga jalur berakhirnya sesi, berlaku bersamaan dan tidak saling meniadakan**: (a) "Keputusan Akhir" manual — pemain klik kapan saja, di kondisi apa pun; (b) sinyal Level 1 — mendorong pemain memilih mengakhiri, tapi keputusan tetap di tangan pemain; (c) force quit Level 2 — sistem yang memutuskan otomatis, tanpa menunggu pemain, sebagai backstop terakhir. Detail di Bagian 6.

---

## 3. Tech Stack

| Layer | Teknologi | Catatan |
|---|---|---|
| FE Sementara (validasi) | React + Vite, `@livekit/components-react` | Sedang dibangun James untuk validasi pipeline |
| FE Game (utama) | React + Vite *(perlu konfirmasi — lihat Bagian 10)* | Tilemap 2D, dikerjakan tim FE terpisah |
| Backend API | Python FastAPI | Mint token saja — `server.py` |
| Voice worker | `livekit-agents` + `livekit-plugins-azure` + `livekit-plugins-openai` | `voice_agent.py`, proses long-running terpisah dari `server.py` |
| STT/TTS | Azure Speech, region `eastus2` | Voice ID final per NPC menunggu konfirmasi nama (lihat Bagian 10) |
| Dialogue LLM | Azure OpenAI `gpt-5-mini`, `reasoning_effort="none"` | Fallback: DeepSeek V4 Flash |
| Observer (level drift) | Azure OpenAI `gpt-5-mini` (deployment sama, panggilan terpisah & asinkron) | Tidak perlu model/plugin baru — lihat Bagian 6 |
| AI Auditor LLM | Azure OpenAI `gpt-5.4` | Dipanggil sekali per sesi, saat salah satu dari tiga jalur penyelesaian terpicu |
| Transport realtime | LiveKit Cloud, tier Build (gratis) | Lihat Bagian 5 soal kuota |
| Referensi arsitektur | `medkit-app` (bedriyan), `livekit-examples/agent-starter-react` | Referensi pola, bukan basis wajib |

---

## 4. Struktur Direktori

```
/apps
  /web              → FE game (tilemap)
  /web-sementara    → FE validasi (React + Vite)
  /backend
    /api            → server.py (FastAPI, mint token)
    /voice_worker   → voice_agent.py (livekit-agents)
```

*(Asumsi: `/apps/backend` mempertahankan pemisahan `/api` dan `/voice_worker` seperti yang sudah disepakati sebelumnya — tolong koreksi kalau berubah.)*

---

## 5. Arsitektur Sistem & Alur Koneksi

**Alur per sesi skenario:**

1. FE (game atau sementara) memanggil `server.py` → `POST /token` dengan `scenario_id` → menerima LiveKit access token + nama room baru (unik per sesi, misal `rat-{uuid}`).
2. FE join room via LiveKit client SDK menggunakan token tsb.
3. `voice_agent.py` (worker yang sudah registered dengan `LIVEKIT_AGENT_NAME` yang sama) menerima dispatch untuk room baru ini, membaca `scenario_id` dari room metadata, dan menginisialisasi persona/system prompt yang sesuai skenario tsb.
4. Percakapan voice/teks berlangsung antara pemain dan NPC(s) lewat `gpt-5-mini`. Secara paralel (Skenario 2-4 saja), observer memantau tiap giliran untuk menghitung level drift — lihat Bagian 6.
5. Sesi berakhir lewat salah satu dari tiga jalur (Bagian 6): Keputusan Akhir manual, sinyal Level 1, atau force quit Level 2 → `voice_agent.py` mengirim transkrip penuh sesi (sejauh yang berlangsung) ke `gpt-5.4` (AI Auditor) → menerima hasil klasifikasi state + skor + narasi → mengirim balik ke FE (via data channel/RPC) untuk ditampilkan. Level drift itu sendiri juga dipublikasikan ke FE secara kontinu sepanjang sesi untuk indikator ketegangan dalam game (lihat Bagian 9).
6. Room ditutup. Tidak ada data yang disimpan pasca-sesi.

**Kenapa satu room per skenario (bukan satu room berkelanjutan):** ChatContext tetap bersih per skenario (tidak ada risiko satu NPC "mengingat" percakapan skenario lain); klasifikasi akhir lebih sederhana karena satu room = satu transkrip = satu skenario, tidak perlu logic pemisah transkrip gabungan. Trade-off-nya hanya jeda koneksi ±1-3 detik tiap perpindahan skenario (handshake WebRTC baru) — dianggap dapat diterima dibanding kompleksitas reset ChatContext manual dalam satu room berkelanjutan.

**Kuota LiveKit Cloud (tier Build/gratis):** Jumlah room yang dibuat tidak dibatasi/gratis (room bersifat ephemeral). Yang diukur adalah waktu pemakaian — sekitar 1.000 agent session minutes, 5.000 WebRTC minutes, dan 50GB transfer per bulan, reset tiap awal bulan kalender, bertindak sebagai hard cap (bukan overage berbayar) di tier gratis. Room-per-skenario vs room-berkelanjutan mengonsumsi kuota yang identik karena yang dihitung adalah total waktu tersambung. Estimasi 1.000 menit/bulan setara ±16-17 jam waktu agent aktif — cukup luas untuk skala testing hackathon. Limit *concurrent* session (testing paralel oleh >1 orang bersamaan) belum terverifikasi angka pastinya untuk tier Build, namun tidak relevan untuk saat ini karena tim tidak melakukan testing paralel.

---

## 6. Model State: Tiga Lapis (Prompting → Observer → Post-hoc)

### Lapisan 1 — Nada NPC real-time (gratis, via prompting)

Setiap persona NPC diberi instruksi eksplisit di system prompt tentang bagaimana sikap/nadanya berevolusi berdasarkan pola interaksi pemain (contoh generik: "makin defensif jika dituduh, makin terbuka jika didekati dengan empati"). Bekerja otomatis lewat ChatContext yang sudah membawa riwayat percakapan — tidak butuh state variable maupun tool call. `gpt-5-mini` tetap berjalan di `reasoning_effort="none"` tanpa beban tambahan.

### Lapisan 2 — Observer level drift (real-time, non-blocking)

Menjawab kebutuhan agar sistem bisa "memahami secara bertahap" ketika pemain konsisten menyimpang ke arah tertentu, dan agar sesi bisa berakhir lebih awal dari "Keputusan Akhir" manual jika penyimpangan sudah sangat jelas — tanpa menghilangkan hak pemain untuk mengakhiri kapan saja secara manual.

**Mekanisme:** sebuah observer mendengarkan event `conversation_item_added` milik `AgentSession` (terpicu tiap giliran — pemain maupun NPC — tercatat ke riwayat) dan mengevaluasi giliran itu lewat panggilan LLM terpisah yang berjalan di task asinkron, di luar jalur respons suara utama. Karena berjalan paralel, ini tidak menambah latency ke `gpt-5-mini`/TTS. Observer memakai deployment `gpt-5-mini` yang sama (panggilan terpisah, prompt lebih sempit dari roleplay penuh) — tidak perlu model/plugin baru. Frekuensi evaluasi (tiap giliran vs tiap beberapa giliran) adalah parameter yang bisa disetel untuk menyeimbangkan kecepatan deteksi vs biaya panggilan tambahan.

**Hanya melacak arah negatif/menyimpang** — bukan dua arah. Kalau pemain sangat konsisten baik, sesi tetap menunggu "Keputusan Akhir" manual seperti biasa; tidak ada analogi natural untuk "sesi berakhir lebih cepat karena pemain terlalu baik".

**Skala level (per skenario, satu dimensi drift):**

| Level | Arti | Efek |
|---|---|---|
| 0 — Netral | Kondisi awal/normal | Tidak ada efek tambahan |
| 1 — Kondisi terpenuhi | Pola menyimpang jelas dari beberapa giliran berturut-turut | Dipublikasikan real-time ke FE untuk indikator ketegangan dalam game; pemain **didorong** memilih "Keputusan Akhir" sekarang, tapi tetap boleh melanjutkan bermain |
| 2 — Maksimal | Penyimpangan sudah sangat jelas & bertahan | Sesi **diakhiri otomatis oleh sistem** (force quit) — transkrip yang ada dikirim ke AI Auditor tanpa menunggu aksi pemain |

Level **bisa naik maupun turun** antar giliran (bukan akumulasi permanen) — jika pemain sempat menyimpang lalu benar-benar berbalik menunjukkan itikad baik, level bisa turun kembali. Ini konsisten dengan prinsip "model paham secara bertahap", bukan vonis sekali jalan yang tidak bisa dipulihkan.

**Kalibrasi (perlu kehati-hatian):** threshold yang terlalu sensitif berisiko salah membaca perilaku investigatif-tapi-sah (misalnya bertanya kritis di Skenario 2, yang justru diminta dokumen sumber) sebagai penyimpangan. Rekomendasi: threshold longgar — perlu beberapa giliran yang konsisten jelas buruk, bukan satu ucapan ambigu. Sesi yang telat berakhir jauh lebih aman daripada sesi yang terlalu cepat memotong pemain yang justru sedang benar. Angka pasti (berapa giliran, berapa skor) belum ditentukan di dokumen ini — perlu tuning saat implementasi/playtest.

### Tiga jalur berakhirnya sesi (berlaku bersamaan, tidak saling meniadakan)

1. **Keputusan Akhir manual** — pemain klik kapan saja, di level berapa pun. Tidak berubah dari desain awal.
2. **Sinyal Level 1** — mendorong pemain memilih mengakhiri; keputusan tetap di tangan pemain.
3. **Force quit Level 2** — sistem yang memutuskan, tidak menunggu pemain. Backstop terakhir agar sesi tidak berlarut-larut di kondisi yang sudah sangat jelas buruk.

### Lapisan 3 — Klasifikasi formal post-hoc (AI Auditor)

Begitu salah satu dari tiga jalur di atas terpicu, seluruh transkrip sesi (berlabel giliran & pembicara) dikirim ke `gpt-5.4` dalam satu panggilan. Auditor inilah satu-satunya komponen yang perlu "mengenal" taksonomi state formal per skenario. **Penting:** level drift di Lapisan 2 hanya mekanisme *trigger* dan *sinyal UI* — bukan pengganti klasifikasi. Level tidak otomatis menentukan hasil akhir; ia hanya menentukan **kapan** evaluasi Auditor dipanggil. Klasifikasi tetap sepenuhnya bergantung pada pembacaan holistik `gpt-5.4` atas transkrip yang ada.

**Skema input ke AI Auditor** (per panggilan):
- `scenario_id`
- Transkrip penuh (berlabel giliran & pembicara)
- Jalur pemicu (`manual` / `sinyal_level_1` / `force_quit_level_2`) — konteks tambahan bagi Auditor, bukan penentu klasifikasi
- Definisi taksonomi state untuk skenario ini (daftar `State_X` yang mungkin + grounding regulasi terkait)
- Contoh gaya narasi evaluasi (few-shot, dari skenario yang sudah ada teksnya — lihat Bagian 7)

**Skema output yang direkomendasikan** (JSON, agar mudah dikonsumsi FE):
```json
{
  "scenario_id": "kredit_macet",
  "trigger": "force_quit_level_2",
  "state_classification": {
    "State_Analisis_Masalah": "BENAR",
    "State_Jalur_Remedi": "MELANGGAR_PROSEDUR"
  },
  "scores": { "member_centric": 40, "compliance": 35, "soft_skills": 30 },
  "ending_type": "bad",
  "narrative_feedback": "..."
}
```
Rekomendasi: prompt `gpt-5.4` secara eksplisit untuk merespons hanya JSON valid sesuai skema ini, tanpa teks pembuka/penutup, agar parsing di sisi backend sederhana dan tidak rapuh.

---

## 7. Alur per Skenario

Catatan umum yang berlaku di Skenario 2-4 (Skenario 1 tidak menerapkan Lapisan 2 — lihat 7.1): sesi bisa berakhir lewat tiga jalur yang dijelaskan di Bagian 6 — manual, sinyal Level 1, atau force quit Level 2 — dan ketiganya memicu pemanggilan AI Auditor yang sama; yang membedakan hanya siapa/apa yang memicu dan kapan. Klasifikasi opsi mana yang sebenarnya terjadi (Opsi A/B/C ala dokumen skenario) tetap murni hasil pembacaan post-hoc oleh AI Auditor — bukan pemain memilih opsi secara literal lewat tombol.

### 7.1 Skenario 1 — Tutorial (Koperasi Konsumen)

- **NPC:** Ibu rumah tangga (non-anggota), single persona.
- **Alur teknis:** Alur linear, tanpa percabangan. Tidak memerlukan taksonomi state, observer Lapisan 2, maupun panggilan AI Auditor — dokumen skenario menunjukkan evaluasi akhirnya adalah pesan selamat yang tetap/tidak bervariasi, sehingga bisa berupa pesan terskrip di sisi FE/backend, bukan hasil generate `gpt-5.4`. Ini mengurangi kompleksitas backend untuk skenario ini secara signifikan.
- **Sinyal selesai:** Aksi "Bayar & Daftar" (mendaftar keanggotaan + membayar Simpanan Pokok bersamaan transaksi) — bisa berupa RPC sederhana dari FE begitu NPC menyatakan setuju.

### 7.2 Skenario 2 — Kredit Macet

- **NPC:** Pak Joko (pemilik warung, menunggak cicilan), single persona.
- **Taksonomi state:**
  - `State_Analisis_Masalah` ∈ {`BENAR`, `SALAH`}
  - `State_Jalur_Remedi` ∈ {`SESUAI`, `MELANGGAR_PROSEDUR`, `NAIF`}
- **Dimensi drift (Lapisan 2):** kecenderungan ke `MELANGGAR_PROSEDUR` — nada mengancam/kaku berulang terhadap Pak Joko. Level 1: indikator ketegangan naik, pemain didorong mengambil Keputusan Akhir. Level 2: Pak Joko menutup diri dan menolak melanjutkan percakapan → sesi dipaksa berakhir.
- **Grounding untuk prompt Auditor:** Asas kekeluargaan (UU 25/1992), Permenkop No. 8/2023, mekanisme 3R (Rescheduling/Reconditioning/Restructuring).
- **Ketersediaan teks evaluasi:** Teks lengkap tersedia untuk jalur `SESUAI` (good ending) dan `MELANGGAR_PROSEDUR` (bad ending). Jalur `NAIF` belum punya teks eksplisit di dokumen sumber — lihat catatan desain di bawah.
- **Sinyal selesai:** Lihat catatan umum Bagian 7 — manual setelah fase investigasi, sinyal Level 1, atau force quit Level 2.

### 7.3 Skenario 3 — Keanggotaan Fiktif

- **NPC:** Pak Bambang (Bendahara Senior), single persona.
- **Taksonomi state:**
  - `State_Verifikasi_Data` ∈ {`DIBERSIHKAN`, `DIBIARKAN`}
  - `State_Relasi_NPC` ∈ {`TERJAGA`, `RUSAK`}
- **Dimensi drift (Lapisan 2):** kecenderungan ke `RUSAK` — nada menuduh/represif ke Pak Bambang. Level 2: Pak Bambang menutup diri, menolak kooperasi lebih jauh → sesi dipaksa berakhir.
- **Grounding untuk prompt Auditor:** UU 25/1992 Pasal 17(2) & Pasal 30(1)(f), dampak dilusi SHU (Pasal 5(1)(c)).
- **Ketersediaan teks evaluasi:** Teks lengkap hanya untuk kombinasi `DIBERSIHKAN` + `TERJAGA` (Pilihan C/good ending). Kombinasi lain (A, B) belum punya teks eksplisit.
- **Sinyal selesai:** Lihat catatan umum Bagian 7. *Asumsi tidak berubah: "Periksa Dokumen" adalah fitur FE murni (data statis), tidak memerlukan pemrosesan backend/AI — tolong konfirmasi jika keliru.*

### 7.4 Skenario 4 — RAT (Rapat Anggota Tahunan)

- **NPC:** Dua persona simultan dalam satu room — *(nama menunggu konfirmasi, lihat Bagian 10)*: anggota kaya/arogan yang menekan dengan modal, dan anggota kecil yang mewakili suara petani/pedagang.
- **State machine fase (khusus skenario ini):** Fase 1 (Buka Rapat — cek kuorum) → Fase 2 (Baca LPJ → trigger scripted: interupsi kasar dari NPC anggota kaya) → Fase 3 (Ambil Keputusan — opsional akses mekanik "Periksa Dokumen Tata Tertib"). Disimpan sebagai metadata room, bukan database.
- **Logic penentuan NPC aktif:** (a) trigger fase eksplisit — transisi ke Fase 2 otomatis mengalihkan persona aktif ke NPC anggota kaya untuk momen interupsi scripted; (b) heuristik penyebutan nama — jika pemain menyebut nama salah satu NPC secara eksplisit, NPC tersebut merespons giliran berikutnya.
- **Taksonomi state:**
  - `State_Proses_Rapat` ∈ {`TUNTAS`, `BUBAR`}
  - `State_Keabsahan_Keputusan` ∈ {`SAH_DEMOKRATIS`, `TUNDUK_TEKANAN_MODAL`, `TIDAK_BERLAKU`}
- **Dimensi drift (Lapisan 2):** kecenderungan ke `BUBAR` — eskalasi konflik/konfrontasi dengan NPC anggota kaya tanpa penyelesaian prosedural. Skenario ini paling natural untuk Lapisan 2 karena Level 2 (force quit) **identik** dengan `State_Proses_Rapat = BUBAR` yang memang sudah menjadi bagian dari desain asli skenario — mekanisme drift di sini bukan tambahan asing, melainkan cara konsisten untuk memicu kondisi yang sudah dirancang sejak awal.
- **Grounding untuk prompt Auditor:** UU 25/1992 Pasal 22(1), Pasal 23, Pasal 5(1)(b) & (d), Permenkop No. 19/PER/M.KUKM/IX/2015.
- **Ketersediaan teks evaluasi:** Teks lengkap hanya untuk kombinasi `TUNTAS` + `SAH_DEMOKRATIS` (Pilihan C/good ending). Kombinasi lain belum punya teks eksplisit.
- **Sinyal selesai:** Lihat catatan umum Bagian 7 — manual di penghujung Fase 3, sinyal Level 1, atau force quit Level 2 (= BUBAR).

**Catatan desain lintas-skenario soal teks evaluasi yang belum lengkap:** Pola yang konsisten muncul di Skenario 2, 3, dan 4 — hanya jalur ending "terbaik" yang sudah punya naskah evaluasi lengkap di dokumen sumber; jalur-jalur lain belum. Karena `gpt-5.4` sudah didesain men-generate narasi (bukan memilih dari teks tersimpan), rekomendasi saya: perlakukan naskah yang sudah ada sebagai *few-shot style anchor* (contoh gaya & nada), dan minta Auditor men-generate narasi yang sepadan untuk kombinasi state apa pun yang tercapai — bukan menunggu tim menulis naskah secara manual untuk tiap kombinasi. Ini rekomendasi teknis, bukan keputusan final — perlu disetujui tim karena menyentuh bagaimana konten akhir pemain dihasilkan.

---

## 8. Data & Persistensi

Tidak ada tabel database untuk MVP ini. Seluruh state (fase aktif, ChatContext, level drift, hasil klasifikasi & skor) hidup di memory selama room LiveKit aktif dan hilang begitu room ditutup. Jika ke depannya dibutuhkan (misalnya untuk leaderboard demo saat Awarding Day), ini akan jadi keputusan terpisah yang butuh PRD tambahan — di luar cakupan dokumen ini.

---

## 9. Referensi ke Dokumen Kontrak (disusun terpisah)

Setelah PRD ini disepakati, dokumen kontrak ringkas akan dibuat berisi: (1) daftar REST endpoint (`POST /token`, dst.) beserta shape request/response, dan (2) daftar event LiveKit data channel beserta payload — mencakup minimal: mulai skenario, Petunjuk, transisi fase (khusus RAT), Keputusan Akhir, hasil skor AI Auditor, **dan level drift real-time** (Bagian 6 Lapisan 2) — kemungkinan besar lewat participant attribute atau data message yang diperbarui tiap kali level berubah, dipakai FE untuk indikator ketegangan dan penonjolan tombol Keputusan Akhir saat Level 1 tercapai. Bentuk UI persisnya sepenuhnya keputusan tim FE; backend hanya menjamin nilai level tersedia real-time. Dokumen kontrak ini menjadi sumber kebenaran bersama untuk FE Game dan FE Sementara.

---

## 10. Asumsi & Pertanyaan Terbuka

1. **Nama NPC RAT** — dokumen skenario terbaru menyebut Pak Darma & Ibu Sri, berbeda dari Pak Marjuki & Bu Sulastri yang dibahas di sesi sebelumnya. PRD ini mengasumsikan dokumen terbaru sebagai acuan final.
2. **Tech stack FE Game utama** — sebelumnya direncanakan Next.js + TypeScript; pesan terbaru menyebut React + Vite untuk "tim FE", tapi belum jelas apakah ini menggantikan Next.js untuk FE Game utama, atau spesifik untuk FE Sementara saja.
3. **"Periksa Dokumen"** (Skenario 3 & 4) diasumsikan fitur FE murni (data statis), tanpa keterlibatan backend/AI.
4. **Voice mapping** — `id-ID-ArdiNeural`/`id-ID-GadisNeural` sebelumnya dipetakan ke Pak Marjuki/Bu Sulastri; perlu dipetakan ulang ke NPC final RAT begitu poin 1 terkonfirmasi.
5. **Threshold level drift** (berapa giliran buruk berturut-turut untuk naik ke Level 1/2, per skenario) belum ditentukan angkanya di dokumen ini — perlu tuning saat implementasi/playtest, dengan bias ke arah longgar (lihat Bagian 6).
6. **Generasi naratif dinamis untuk ending non-optimal** (Bagian 7, catatan lintas-skenario) adalah rekomendasi teknis yang perlu persetujuan tim, bukan keputusan final.
7. **Bentuk visual indikator ketegangan & sinyal Level 1** di UI adalah keputusan tim FE — PRD ini hanya menjamin data level tersedia real-time untuk dikonsumsi (Bagian 9).