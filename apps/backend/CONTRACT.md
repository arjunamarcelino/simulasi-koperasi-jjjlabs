# CONTRACT.md — Kontrak Integrasi FE ↔ Backend

Sumber kebenaran wire antara Frontend (game `apps/web`) dan backend. Ini
mengonkretkan PRD §9. Implementasi referensi yang bekerja:
`apps/web/src/session/transport/livekit/LiveKitTransport.ts`.
Di game `apps/web`, header `Authorization: Bearer` dilampirkan oleh
`src/lib/authedFetch.ts` (yang juga meng-handle refresh+retry pada `401`) dan
dipakai `src/session/transport/livekit/LiveKitTransport.ts`.

> Prinsip: **voice sebagai jalur utama, teks sebagai fallback** (PRD Prinsip 4).
> Keduanya masuk lewat jalur yang sama begitu sampai di agent.

---

## 1. Alur satu sesi

```
FE  POST /token {scenario_id}         → {token, room, url}
    (header Authorization: Bearer <supabase-jwt>; diverifikasi backend, §2)
FE  room.connect(url, token)          (LiveKit client)
    → agent otomatis ter-dispatch ke room (bawa scenario_id)
    → agent join (~12–19 dtk), NPC menyapa (transkripsi + audio)
FE  ↔ agent: voice (mic) / teks (RPC send_text)
    agent → FE: transkripsi, attribute drift_level & phase, data message speaker
    sesi berakhir via 3 jalur → hasil AI Auditor → FE tampilkan
FE  room.disconnect()                 (sesi selesai; tak ada data disimpan)
```

Satu **room baru per sesi skenario** (nama unik `{scenario_id}-{uuid8}`). Ganti
skenario = token baru = room baru.

`scenario_id` yang valid:
`tutorial-koperasi-konsumen`, `kredit-macet`, `keanggotaan-fiktif`,
`rapat-anggota-tahunan`.

---

## 2. REST — token server

### `POST /token`
**Wajib** header `Authorization: Bearer <supabase-jwt>` (access token Supabase dari
FE). Backend memverifikasi JWT (JWKS/ES256; cek `exp`/`aud`=authenticated/`iss`)
SEBELUM mint token LiveKit (SIM-4). Karena header ini, request menjadi
CORS-preflighted; backend mengizinkan header `Authorization` + menangani `OPTIONS`.

Request:
```json
{ "scenario_id": "kredit-macet" }
```
Response `200`:
```json
{ "token": "<jwt>", "room": "kredit-macet-3a3c81a8", "url": "wss://...livekit.cloud" }
```

Status:

| kode | arti | perilaku FE (`authedFetch`) |
|---|---|---|
| `200` | token diterbitkan | connect ke room |
| `401` | token hilang/invalid/kedaluwarsa (`WWW-Authenticate: Bearer`) | refresh sesi + retry SEKALI |
| `422` | `scenario_id` tak dikenal (dicek SETELAH auth) | surface error |
| `429` | rate limit per-user terlampaui (`Retry-After`) | surface error |
| `500` | verifier/LiveKit belum dikonfigurasi (fail-closed) | surface error |
| `503` | endpoint JWKS tak terjangkau | surface error |

`403` kini **dipakai** oleh gerbang admin `GET /admin/me` (SIM-14, di bawah); `/token`
sendiri tak pernah 403.

**Rate limit (`429`):** batas per-user (`sub`) in-memory pada `/token` (tiap mint
men-dispatch agent LLM berbayar). Batas ini **tidak** membatasi abuse anonim secara
agregat — tiap sign-in anonim menghasilkan `sub` baru (= kuota baru). Pembatasan
abuse anonim diserahkan ke **CAPTCHA + rate-limit sign-in anonim sisi Supabase
(SIM-1)**; ceiling mint global/per-IP di backend adalah kandidat pengerasan lanjutan.

**Identitas peserta** kini = Supabase `sub` (UUID) — bukan lagi berawalan
`player-`. Penemuan agent tetap lewat prefix `agent-`/`kind=agent` (§3), jadi tak
terpengaruh; jangan mengasumsikan prefix `player-` di sisi mana pun.

**Metadata peserta (wire server→worker, tepercaya, dari JWT terverifikasi):**
`participant.metadata` = JSON `{"user_id": "<sub>", "is_anonymous": <bool>}` —
agar jalur worker mengatribusikan sesi ke user server-side. `is_anonymous:true`
menandai guest (RLS Postgres, bukan endpoint ini, yang menolak reward guest).
Terpisah dari **job metadata** dispatch `{scenario_id}` (§1).

### `GET /admin/me`
Gerbang area admin (SIM-14). **Wajib** `Authorization: Bearer <supabase-jwt>`. Backend
memverifikasi JWT (sama seperti `/token`) lalu `require_role('admin')`: lolos hanya
bila klaim **top-level `is_admin == true` DAN `is_anonymous == false`** (tak ada admin
anonim). Klaim `is_admin` distempel ke JWT oleh Custom Access Token Hook Supabase dari
tabel `public.admins` (SIM-14 DB).

Response `200`:
```json
{ "user_id": "<sub>" }
```
Body hanya `user_id` (untuk tampilan). **Otorisasi ada di KODE STATUS, bukan body** —
`200` berarti admin; FE memutuskan gerbang dari status, tak pernah dari isi body.

Status:

| kode | arti | perilaku FE |
|---|---|---|
| `200` | admin terverifikasi | render shell admin |
| `401` | token hilang/invalid/kedaluwarsa (`WWW-Authenticate: Bearer`) | refresh sesi + retry SEKALI → login |
| `403` | authenticated non-admin **atau** sesi anonim | "tak berwenang" (body `{"detail":"forbidden"}`, identik untuk kedua sebab); JANGAN refresh-loop |
| `500` | verifier belum dikonfigurasi (fail-closed) | surface error |
| `503` | endpoint JWKS tak terjangkau | surface error |

Konsumen: **app admin terpisah** (`apps/admin`), bukan game. Gerbang client hanya
tampilan — server (JWT terverifikasi + `require_role`) yang otoritatif.

### `GET /admin/metrics`
Metrik dasbor admin (SIM-15). **Wajib** `Authorization: Bearer <supabase-jwt>`; sama
`require_role('admin')` seperti `/admin/me` (401 → 403 SEBELUM sentuh DB). Backend membuka
pool asyncpg **fail-soft** sebagai role `metrics_reader` (EXECUTE-only) dan memanggil
`admin.metrics_overview()`. Semua `*_rate`/`avg_*` bernilai **number ATAU `null`** (`null` =
tak terdefinisi: pembagi 0 / tak ada sesi berskor) — FE merender `null` sebagai "—". Rate
berupa pecahan `[0,1]` (bukan persen/teks). `per_scenario` memuat SEMUA skenario `AVAILABLE`
(urut by title), termasuk yang 0 sesi.

Response `200`:
```json
{
  "generated_at": "2026-10-09T04:00:00Z",
  "users": { "active_30d": 42, "total_registered": 120, "new_7d": 8 },
  "sessions": {
    "total": 300, "completion_rate": 0.9,
    "ending_split": { "good": 0.5, "neutral": 0.3, "bad": 0.2 }, "avg_score": 71.4
  },
  "per_scenario": [
    { "scenario_id": "kredit-macet", "title": "Kredit Macet", "sessions": 120,
      "completion_rate": 0.9, "ending_split": { "good": 0.6, "neutral": 0.2, "bad": 0.2 },
      "avg_score": 73.2 }
  ]
}
```

Status:

| kode | arti | perilaku FE |
|---|---|---|
| `200` | metrik admin | render dasbor |
| `401` | token hilang/invalid/kedaluwarsa (`WWW-Authenticate: Bearer`) | refresh + retry SEKALI → login |
| `403` | authenticated non-admin **atau** sesi anonim (`{"detail":"forbidden"}`) | "tak berwenang"; JANGAN refresh-loop |
| `503` | DB metrik tak dikonfigurasi/tak terjangkau/lambat (fail-soft) | state "layanan tidak tersedia" + retry |
| `500` | verifier JWT belum dikonfigurasi (fail-closed) | surface error |

Konsumen: `apps/admin` (dasbor). `completion_rate` = sesi yang BUKAN `force_quit_level_2` ÷
total (`sinyal_level_1` dihitung selesai — akhir terpandu tapi sukarela; hanya force-quit L2 =
tak selesai); `avg_score` = rata-rata dari mean-rubrik per-sesi (nilai numerik 0–100 saja).

> **Sumber kebenaran bentuk ini = blok JSON di atas.** Ia dikodekan di empat tempat yang harus
> seiring: `admin.metrics_overview()` (SQL), `AdminMetricsResponse` (pydantic, `extra="forbid"`),
> tipe `AdminMetrics` (TS), dan guard `isMetricsBody` (TS). Karena `extra="forbid"`, menambah
> kunci baru TIDAK forward-compatible: tambah field dengan urutan **model+guard dulu, SQL terakhir**
> (SQL duluan → 500 sampai model menyusul).

### `GET /admin/scenarios/{scenario_id}/analytics`
Drill-down analitik per-skenario (SIM-16). **Wajib** `Authorization: Bearer <supabase-jwt>`;
sama `require_role('admin')` (401 → 403 SEBELUM sentuh DB). `scenario_id` divalidasi terhadap
set skenario valid (sama seperti `/token`) SETELAH auth: tak dikenal → **404** (resource di path,
beda dari `/token` yang 422 untuk field di body). Backend memanggil `admin.scenario_analytics($1)`
lewat pool `metrics_reader` yang sama (EXECUTE-only, fail-soft 503). Fungsi **meng-agregat langsung**
dari `public.sessions` (tanpa tabel rollup/trigger). `attempts` = sesi ber-`ended_at` saja (akhir
tercatat; keluar di tengah sesi TIDAK tertangkap). `avg`/`avg_score` = number ATAU `null`. `pillars`
dihitung dari kunci numerik yang MUNCUL di `scores_json` (per-skenario beda; tutorial → `[]`).
`buckets` selalu array panjang 5: `0–20, 21–40, 41–60, 61–80, 81–100`. `dropoff` selalu `null`
sampai modul event-log menyusul (tiket lanjutan).

Response `200`:
```json
{
  "scenario_id": "kredit-macet",
  "title": "Kredit Macet",
  "generated_at": "2026-10-09T04:00:00Z",
  "attempts": 42,
  "outcome": {
    "completed": 38,
    "bubar": 4,
    "by_trigger": { "manual": 30, "sinyal_level_1": 8, "force_quit_level_2": 4 },
    "ending_counts": { "good": 20, "neutral": 15, "bad": 7 }
  },
  "avg_score": 61.5,
  "pillars": [
    { "key": "compliance", "count": 40, "avg": 58.2, "buckets": [3, 9, 12, 10, 6] }
  ],
  "dropoff": null
}
```
Catatan: `outcome` memakai **count** (bukan pecahan). `by_trigger`/`ending_counts` adalah peta
count — `by_trigger` dibiarkan terbuka (dict) agar nilai trigger baru tak merusak kontrak.
`completed` = `attempts − bubar` (bubar = `force_quit_level_2`). Skenario valid tapi 0 sesi →
`200` dengan `attempts:0`, `pillars:[]`, `avg_score:null` (BEDA dari 404 skenario tak dikenal).

Status:

| kode | arti | perilaku FE |
|---|---|---|
| `200` | analitik skenario | render panel drill-down |
| `401` | token hilang/invalid/kedaluwarsa (`WWW-Authenticate: Bearer`) | refresh + retry SEKALI → login |
| `403` | authenticated non-admin **atau** sesi anonim (`{"detail":"forbidden"}`) | "tak berwenang"; JANGAN refresh-loop |
| `404` | `scenario_id` tak dikenal (dicek SETELAH auth, SEBELUM DB) | "skenario tidak ditemukan"; JANGAN retry |
| `503` | DB metrik tak dikonfigurasi/tak terjangkau/lambat (fail-soft) | state "layanan tidak tersedia" + retry |
| `500` | verifier JWT belum dikonfigurasi (fail-closed) | surface error |

Konsumen: `apps/admin` (panel drill-down dari klik baris `ScenarioTable`).

> **Sumber kebenaran bentuk ini = blok JSON di atas.** Ia dikodekan di empat tempat yang harus
> seiring: `admin.scenario_analytics(text)` (SQL), `ScenarioAnalyticsResponse` (pydantic,
> `extra="forbid"` di model luar), tipe `ScenarioAnalytics` (TS), dan guard
> `isScenarioAnalyticsBody` (TS). `extra="forbid"` → tambah kunci dengan urutan **model+guard
> dulu, SQL terakhir**. Endpoint & model TERPISAH dari `/admin/metrics` (kontrak beku itu tak
> disentuh).

### `GET /admin/leaderboard?season_id=<uuid?>`
Papan peringkat XP musiman — dasbor admin (SIM-17). **Wajib** `Authorization: Bearer
<supabase-jwt>`; sama `require_role('admin')` (401 → 403 SEBELUM sentuh DB). `season_id`
OPSIONAL (query) divalidasi FastAPI sebagai `UUID` → salah bentuk = **422** sebelum DB
disentuh. Backend memanggil `admin.leaderboard_overview($1)` lewat pool `metrics_reader`
yang SAMA (EXECUTE-only, fail-soft 503). `season_id` null/absen → musim **terbaru**
(`max(season_number)`). `seasons` urut terbaru-dulu, DIBATASI 50. `selected` = `null` bila
belum ada musim. Entri **TIDAK** memuat `user_id` (batas privasi).

Response `200`:
```json
{
  "seasons": [
    { "id": "…uuid…", "season_number": 2, "label": "Awarding Day",
      "captured_at": "2026-10-09T04:00:00Z", "entry_count": 42 }
  ],
  "selected": {
    "id": "…uuid…", "season_number": 2, "label": "Awarding Day",
    "captured_at": "2026-10-09T04:00:00Z", "entry_count": 42,
    "entries": [ { "rank": 1, "display_name": "Budi", "xp": 1500, "level": 6 } ]
  }
}
```
`selected` `null` bila belum ada musim; `label` nullable; `entries` urut by `rank` (1-based,
kontigu), maks 100.

### `POST /admin/leaderboard/capture`
Bekukan standing XP saat ini menjadi musim baru (aksi admin manual). Body `{ "label"?: string }`
(maks 120 char; model `extra="forbid"` → kunci asing/overlong = **422**). Memanggil
`admin.capture_leaderboard_snapshot($1)`. Ranking by `user_progress.xp desc` (hanya `xp>0`),
limit 100, rank kontigu 1..N; `level` dibekukan via `level_from_xp`; `display_name` di-snapshot
(null → `"Anggota"`). Basis pemain kosong/semua-0 XP → musim valid ber-`entry_count:0`.

Response `200`:
```json
{ "season_id": "…uuid…", "season_number": 3, "captured_at": "2026-10-09T04:00:00Z", "entry_count": 42 }
```

### `DELETE /admin/leaderboard/seasons/{season_id}`
Hapus satu musim (cascade ke entrinya). `season_id` (path) divalidasi `UUID` (422 bila salah).
Memanggil `admin.delete_leaderboard_season($1)` yang mengembalikan `{deleted, season_number}`:
`deleted:false` (musim tak ada) → backend memetakan ke **404** (BUKAN 503 — nilai balik, bukan
raise, agar tak tertelan broad-except fail-soft).

Response `200`:
```json
{ "deleted": true, "season_number": 3 }
```

Status (ketiga endpoint di atas):

| kode | arti | perilaku FE |
|---|---|---|
| `200` | sukses | render / toast sukses |
| `401` | token hilang/invalid/kedaluwarsa (`WWW-Authenticate: Bearer`) | refresh + retry SEKALI → login |
| `403` | authenticated non-admin **atau** sesi anonim (`{"detail":"forbidden"}`) | "tak berwenang"; JANGAN refresh-loop |
| `404` | **DELETE saja** — `season_id` tak ada | refresh daftar (anggap sudah terhapus); JANGAN error keras |
| `422` | `season_id` bukan UUID / `label` melanggar batas (dicek SEBELUM DB) | surface error (lihat catatan) |
| `503` | DB tak dikonfigurasi/tak terjangkau/lambat (fail-soft) | state "layanan tidak tersedia" + retry |

> Catatan `422`: klien `apps/admin` **tidak bisa** memicunya (UUID selalu terbitan server; `label`
> dibatasi `maxLength=120` di input) sehingga klien tak punya penanganan khusus — non-2xx tak
> terduga runtuh ke state "layanan tidak tersedia". Baris `422` mendokumentasikan wire mentah untuk
> pemanggil non-UI (mis. agent yang mengirim UUID/label salah-bentuk).

Konsumen: `apps/admin` (panel leaderboard). **Capture/delete adalah WRITE** lewat
`SECURITY DEFINER` — `metrics_reader` kini mengeksekusi tulis/hapus (tetap TANPA privilege tabel
langsung); blast radius `METRICS_DB_URL` meluas (baca → tulis admin-gated).

**Papan in-game ("mading")**: BUKAN lewat backend ini — game memanggil RPC Supabase
`public.leaderboard_current()` langsung via `supabase-js` (granted `anon`/`authenticated`,
seperti `public.leaderboard()` lama). Mengembalikan baris `{ display_name, xp, level, rank }`
musim terbaru (top 20), **tanpa** `user_id`. Papan kosong ("Papan musim belum tersedia") bila
belum ada musim. Board live lama `public.leaderboard()` DIBIARKAN (tak dipakai mading).

> **Sumber kebenaran bentuk ini = blok JSON di atas.** Dikodekan di empat tempat yang harus
> seiring: fungsi SQL (`admin.capture_leaderboard_snapshot`/`delete_leaderboard_season`/
> `leaderboard_overview` + `public.leaderboard_current`), model pydantic (`extra="forbid"` di
> model luar), tipe TS, dan guard TS. Fungsi tulis WAJIB `VOLATILE` (jangan salin `stable` dari
> `scenario_analytics`).

### `GET /admin/reports/sessions.csv?from=<date?>&to=<date?>`
Ekspor CSV hasil sesi untuk pelaporan offline (SIM-19). **Wajib** `Authorization: Bearer
<supabase-jwt>`; sama `require_role('admin')` (401 → 403 SEBELUM sentuh DB). **Respons non-JSON
pertama di backend**: unduhan `text/csv; charset=utf-8` ter-buffer (header `Content-Disposition:
attachment; filename="koperasi-sessions-YYYYMMDD.csv"`, tanggal UTC) — BUKAN body JSON. Backend
memanggil `admin.session_results_export($1,$2)` lewat pool `metrics_reader` yang SAMA (EXECUTE-only,
fail-soft 503). **Satu baris per sesi SELESAI** (`ended_at` terisi; sesi terbuka dikecualikan),
**tanpa PII** (tanpa `user_id`/`display_name`).

Query `from`/`to` OPSIONAL (tanggal `YYYY-MM-DD`), memfilter `started_at`, di-anchor UTC, **kedua
hari inklusif** (half-open `[from, to+1hari)`); keduanya absen → semua sesi selesai. Tanggal
salah-bentuk / ada komponen waktu → **422** `{"detail":"from_invalid"|"to_invalid"}` SEBELUM DB.
`from > to` → **200** CSV hanya-header (rentang kosong, bukan error).

Kolom (urutan tetap, nama header identik):
```
session_id,scenario_id,scenario_title,started_at,ended_at,duration_seconds,trigger,ending_type,avg_score
```
`started_at`/`ended_at` ISO-8601 UTC (`…Z`); `duration_seconds` integer ≥ 0; `avg_score` = mean
rubrik per-sesi (numerik 0–100, object-guarded, `round(…,1)`, SAMA seperti `/admin/metrics`) — sel
kosong bila null. CSV RFC-4180 (CRLF, quoting), UTF-8 **dengan BOM** (Excel merender teks Indonesia
benar), dan sel teks admin-authored (`scenario_id`, `scenario_title`) disterilkan dari injeksi
formula (prefix `'`).

Status:

| kode | arti | perilaku klien |
|---|---|---|
| `200` | file CSV | unduh / simpan |
| `401` | token hilang/invalid/kedaluwarsa (`WWW-Authenticate: Bearer`) | refresh + retry SEKALI → login |
| `403` | authenticated non-admin **atau** sesi anonim (`{"detail":"forbidden"}`) | "tak berwenang"; JANGAN refresh-loop |
| `422` | `from`/`to` salah-bentuk (dicek SETELAH auth, SEBELUM DB) | surface error |
| `503` | DB metrik tak dikonfigurasi/tak terjangkau/lambat (fail-soft) | state "layanan tidak tersedia" + retry (body JSON, BUKAN csv) |
| `500` | verifier JWT belum dikonfigurasi (fail-closed) | surface error |

Konsumen: admin (unduh langsung lewat URL / tombol di `apps/admin` — tombol FE adalah tiket
terpisah; bila membaca nama file dari JS perlu `Access-Control-Expose-Headers: Content-Disposition`).

`GET /health` → `{ "status": "ok" }` (tanpa auth). CORS diizinkan untuk origin di env
`CORS_ALLOW_ORIGINS` (comma-split; fallback ke `CORS_ALLOW_ORIGIN` lama; default dev
`http://localhost:5173,http://localhost:5174` = game + admin), method `GET`/`POST`/
`DELETE`/`OPTIONS`, header `Authorization`; ini **bukan** kontrol auth — JWT-lah gerbangnya.

---

## 3. FE → Agent (RPC)

Panggil via `localParticipant.performRpc({ destinationIdentity, method, payload })`.
`destinationIdentity` = identity peserta **agent** (identity berawalan `agent-`,
`kind` = agent). Tunggu agent join dulu. **RAT** punya participant NPC tambahan
(`npc-pak-darma`, lihat §4a); handler RPC yang sama terdaftar di koneksi itu juga,
jadi RPC berhasil ke participant remote mana pun yang dipilih FE.

| method | payload | balasan | keterangan |
|---|---|---|---|
| `end_session` | `""` | `AuditorResult` (JSON string) | "Keputusan Akhir" / "Bayar & Daftar". Jalur **manual**. Agent hentikan NPC & jalankan Auditor. |
| `send_text` | teks pemain | `"ok"` | Jalur fallback teks. Agent membalas seperti giliran suara. |
| `petunjuk` | `""` | `{ "hint": "..." }` (JSON string) | Fitur **Petunjuk** (menggantikan "Tanya Mentor", PRD §9). Mentor (Gemini, model `GEMINI_MENTOR_MODEL`) membaca transkrip → satu saran langkah berikutnya. Tak mengubah percakapan/ChatContext. Semua skenario. |
| `advance_phase` | `""` | `"ok"` / `"noop"` | **RAT saja.** Aksi agenda → maju satu fase. |

Setelah menerima balasan `end_session`, FE menampilkan hasil lalu
`room.disconnect()`.

---

## 4. Agent → FE (attribute, data message, transkripsi)

### 4a. Transkripsi (LiveKit native)
Kata-kata NPC & pemain datang lewat transkripsi LiveKit standar
(`RoomEvent.TranscriptionReceived`), streaming partial→final (`segment.final`).
Transkripsi TIDAK dijamin membawa identitas persona — gunakan sinyal `speaker` (4d)
untuk tahu siapa yang bicara.

**RAT (dua NPC):** tiap NPC adalah participant LiveKit TERPISAH dengan track audionya
sendiri — Ibu Sri memakai koneksi worker (`agent-…`), Pak Darma bergabung sebagai
`npc-pak-darma`. Room RAT berisi 3 participant. Transkripsi NPC datang dari participant
masing-masing; giliran NPC diserialkan (tak pernah dua NPC bersuara bersamaan).
Transkripsi suara **pemain** dipublish worker atas nama identity pemain (STT terpisah),
jadi tetap tiba sebagai transkripsi milik participant lokal.

**Baca transkripsi NPC dari text stream `lk.transcription`** (`registerTextStreamHandler`;
delta per chunk, `lk.segment_id` = id segmen, stream ditutup = final), BUKAN dari
`TranscriptionReceived`: paket legacy dari koneksi NPC kedua (`npc-pak-darma`) tak pernah
sampai ke klien (terbukti live), jadi giliran Pak Darma kosong. `TranscriptionReceived`
hanya dipakai untuk transkripsi pemain (participant lokal). Ikat nama persona (4d) saat
stream dibuka, jangan di tiap chunk.

### 4b. Participant attribute `drift_level` — indikator ketegangan (Lapisan 2)
`RoomEvent.ParticipantAttributesChanged` → `changed["drift_level"]` = `"0" | "1" | "2"`.
- `0` netral, `1` tegang (FE **dorong** pemain klik Keputusan Akhir),
  `2` maksimal (agent akan force-quit; lihat 4e).
Hanya skenario ber-drift (kredit-macet, keanggotaan-fiktif, rapat-anggota-tahunan).
Tutorial tak pernah mengirimnya (anggap 0).

### 4c. Participant attribute `phase` — state machine RAT (RAT saja)
`changed["phase"]` = JSON string:
```json
{ "phase": 1, "label": "Buka Rapat", "advanceActionLabel": "Baca LPJ" }
```
`phase` ∈ {1,2,3}; `advanceActionLabel` = teks tombol agenda berikutnya, atau
`null` di fase terakhir (pengakhiran diserahkan ke `end_session`).

### 4d. Data message topic `speaker` — SIAPA yang bicara
`RoomEvent.DataReceived`, `topic === "speaker"`, payload JSON:
```json
{ "name": "Pak Darma" }
```
Dikirim **tepat sebelum tiap giliran NPC bersuara** (sebelum kata pertama).
**Game WAJIB pakai ini** untuk memutuskan karakter mana yang ditampilkan/
dianimasikan bicara — jangan menebak dari timing. Kata-katanya dari transkripsi
(4a), identitas pembicaranya dari sini. Single-NPC mengirimnya sekali; RAT
mengirim ulang tiap ganti persona.

### 4e. Data message topic `session_ended` — force-quit (jalur c)
`topic === "session_ended"`, payload = `AuditorResult` JSON. Dikirim saat agent
mengakhiri sesi otomatis di **drift Level 2**. FE tampilkan hasil lalu disconnect.
(Untuk jalur **manual**, hasil datang sebagai balasan RPC `end_session`, bukan
data message ini.)

### 4f. Participant attribute `goal_reached` — tujuan skenario tercapai
`RoomEvent.ParticipantAttributesChanged` → `changed["goal_reached"]` = `"1"`.
Dikirim SEKALI saat agent menilai tujuan skenario sudah tercapai — untuk tutorial,
saat ibu (pelanggan) menyatakan **setuju** menjadi anggota (mendaftar + membayar
Simpanan Pokok). Agent memicunya lewat function-tool internal `catat_kesepakatan`.
FE memakainya untuk **membuka tombol akhir** ("Bayar & Daftar" / "Keputusan Akhir")
yang sebelumnya di-disable. Hanya skenario yang mendefinisikan sinyal ini
(saat ini: tutorial); skenario lain tak pernah mengirimnya.

---

## 5. Bentuk data

### `AuditorResult` (balasan `end_session` & payload `session_ended`)
```json
{
  "scenarioId": "kredit-macet",
  "trigger": "manual" | "force_quit_level_2",
  "stateClassification": { "State_Jalur_Remedi": "MELANGGAR_PROSEDUR", "...": "..." },
  "scores": { "member_centric": 40, "compliance": 35, "soft_skills": 30 },
  "endingType": "good" | "bad" | "neutral",
  "narrativeFeedback": "teks evaluasi Bahasa Indonesia"
}
```
Tutorial: `stateClassification` & `scores` = `{}` (pesan selamat terskrip).

### `PhaseState` (isi attribute `phase`, RAT)
```json
{ "phase": 1, "label": "Buka Rapat", "advanceActionLabel": "Baca LPJ" }
```

---

## 6. Taksonomi & skor per skenario (untuk render hasil)

| scenario_id | State (nilai mungkin) | score keys | catatan |
|---|---|---|---|
| `tutorial-koperasi-konsumen` | — | — | tanpa drift/auditor; attribute `goal_reached=1` saat ibu setuju (buka tombol) → sinyal selesai "Bayar & Daftar" (RPC `end_session`) |
| `kredit-macet` | `State_Analisis_Masalah`{BENAR,SALAH}; `State_Jalur_Remedi`{SESUAI,MELANGGAR_PROSEDUR,NAIF} | member_centric, compliance, soft_skills | NPC Pak Joko |
| `keanggotaan-fiktif` | `State_Verifikasi_Data`{DIBERSIHKAN,DIBIARKAN}; `State_Relasi_NPC`{TERJAGA,RUSAK} | integritas_data, compliance, soft_skills | NPC Pak Bambang. "Periksa Dokumen" = fitur FE statis |
| `rapat-anggota-tahunan` | `State_Proses_Rapat`{TUNTAS,BUBAR}; `State_Keabsahan_Keputusan`{SAH_DEMOKRATIS,TUNDUK_TEKANAN_MODAL,TIDAK_BERLAKU} | kepemimpinan, compliance, soft_skills | Dua NPC: Pak Darma & Ibu Sri. Fase 1→2→3 |

Skor 0–100. Nama key skor bisa berbeda antar skenario — render generik dari objek
`scores`, jangan hardcode nama key.

---

## 7. Tiga jalur akhir sesi (PRD §6)

1. **Manual** — FE panggil RPC `end_session` (kapan saja). Hasil = balasan RPC.
   `trigger = "manual"`.
2. **Sinyal Level 1** — attribute `drift_level` jadi `"1"`. FE **dorong** pemain
   (mis. sorot tombol Keputusan Akhir). Keputusan tetap di pemain; sesi belum berakhir.
3. **Force-quit Level 2** — attribute `drift_level` jadi `"2"`; agent mengakhiri
   otomatis → data message `session_ended`. `trigger = "force_quit_level_2"`.

Ketiganya memicu AI Auditor yang sama; yang beda hanya pemicu & bentuk pengiriman.

---

## 7b. Manajemen konten admin — kuis & mading (SIM-18)

CRUD admin-gated di atas pool `metrics_reader` yang SAMA. **Wajib** `Authorization: Bearer <supabase-jwt>`
admin (401→403 SEBELUM sentuh DB, seperti endpoint admin lain). **Kontrak error (load-bearing):**
`_call_definer` memetakan RAISE apa pun → **503**, maka validasi input menghasilkan **422 di boundary
Pydantic** (sebelum RPC) dan hasil not-found/konflik adalah **RETURN `{ok,reason}` terstruktur** dari
fungsi SQL (bukan RAISE) yang route petakan ke status. `reason` tak dikenal → default **422** (kuis &
mading sama); JANGAN pernah jatuh ke 200. Konten di-render **teks-saja** di game (mitigasi XSS; tanpa
HTML sink).

**Kuis** (`quiz_definition`; answer key tetap tersembunyi — baca admin lewat `admin.list_quiz`, bukan
view `quiz_catalog`):
- `GET /admin/quiz` → `{ok, rows:[{code,prompt,options,correct_index,explanation,sort_order,updated_at}]}`.
- `POST /admin/quiz` — CREATE (`code` di body). Opsi 2–4, non-kosong, unik; `0≤correct_index<len(options)`.
- `POST /admin/quiz/{code}` — EDIT. **Wajib** `prev_updated_at` (token CAS dari `updated_at`); mismatch → 409 `stale_write`.
- `DELETE /admin/quiz/{code}` — soft-block 409 `has_completions` bila sudah pernah dijawab; 404 `not_found`.

**Mading** (satu tabel `mading_block(board,payload jsonb)`; `board ∈ info|data|knowledge|identitas`;
dibaca pemain lewat view `public.mading_catalog`):
- `GET /admin/mading` → `{ok, groups:{info:[…],data:[…],knowledge:[…],identitas:…|null}}`.
- `POST /admin/mading` — CREATE (`board`+`block_key`+`payload` di body). Payload divalidasi per-board
  (Pydantic discriminated: info note / data table / knowledge stat|fact / identitas).
- `POST /admin/mading/{id}` — EDIT. **Wajib** `prev_updated_at` (CAS); `board` di body bersifat *advisory*
  (DB validasi payload terhadap board TERSIMPAN; board immutable saat edit).
- `DELETE /admin/mading/{id}` — 404 `not_found`; papan boleh kosong.

CAS atomic: token dilipat ke dalam `WHERE updated_at is not distinct from …` (bukan check-then-update),
sehingga dua edit bersamaan tak bisa sama-sama menang. Konsumen: `apps/admin` (panel kuis + mading);
game membaca `mading_catalog`/`quiz_catalog` live via `supabase-js`. Seed bootstrap satu-arah dari
`@simkop/catalog` (DB otoritatif saat runtime).

## 8. Catatan integrasi untuk FE game

- **Tunggu agent join** sebelum mengizinkan RPC / input. Sapaan NPC pertama =
  sinyal siap. RPC sebelum agent join akan gagal.
- **Mic non-wajib**: tangani izin mic yang ditolak/absen tanpa menjatuhkan sesi —
  teks tetap jalan (`send_text`).
- **Putar audio agent**: LiveKit client mentah tidak auto-play track remote —
  attach track audio ke elemen media (lihat `LiveKitTransport`). Untuk game,
  sinkronkan animasi bicara karakter ke aktivitas track audio + sinyal `speaker`.
- **RAT**: `phase` attribute menggerakkan indikator/tombol agenda; `speaker`
  menggerakkan karakter aktif; interupsi Fase 2 datang otomatis sebagai giliran
  NPC (speaker=Pak Darma). Room berisi participant tambahan `npc-pak-darma` —
  putar SEMUA track audio remote (bukan hanya milik agent).
- **Tanpa persistensi**: semua hilang saat room ditutup. Tak ada endpoint riwayat.
- Bentuk payload di sini adalah kontrak de-facto dari implementasi saat ini;
  perubahan wire harus memperbarui dokumen ini + `LiveKitTransport` bersamaan.
