# CLAUDE.md — Panduan Backend (Koperasi Simulator)

Panduan untuk AI agent yang memodifikasi backend. Baca ini dulu sebelum mengubah
kode. Untuk kontrak wire FE↔BE, lihat `CONTRACT.md`. Untuk desain produk, lihat
`../../docs/backend-prd.md` (PRD).

## Apa ini

Backend + AI pipeline game edukasi koperasi berbasis voice. Dua proses, satu
project `uv`:

- **`api/server.py`** — FastAPI. Verifikasi JWT Supabase lalu mint LiveKit token +
  dispatch agent (`POST /token`, digerbangi `api/auth.py`, rate-limit
  `api/ratelimit.py`). Tanpa database.
- **`voice_worker/voice_agent.py`** — worker `livekit-agents` 1.8 + Google. Satu proses
  menangani SELURUH skenario & persona (PRD §2.1). Single-NPC: Gemini Live (speech-to-speech,
  mendengar mic langsung). RAT: arsitektur "Telinga ≠ Mulut" (Cloud STT + dua NPC Gemini
  Live tanpa telinga + direktur). Observer/auditor/mentor/direktur: Gemini via `google-genai`.

Jalur voice/token **tanpa database** — seluruh state sesi in-memory, hidup selama
room LiveKit aktif (PRD §2.5, §8). **Pengecualian admin (SIM-15/16/17/18/19):** `GET /admin/metrics`
(→ `admin.metrics_overview()`), `GET /admin/scenarios/{id}/analytics` (→ `admin.scenario_analytics()`),
papan peringkat musiman SIM-17 — `GET /admin/leaderboard`, `POST /admin/leaderboard/capture`,
`DELETE /admin/leaderboard/seasons/{id}` (→ `admin.leaderboard_overview/capture_leaderboard_snapshot/
delete_leaderboard_season`), dan **manajemen konten SIM-18** — kuis (`GET /admin/quiz`,
`POST /admin/quiz` create, `POST /admin/quiz/{code}` edit, `DELETE /admin/quiz/{code}`) + mading
(`GET /admin/mading`, `POST /admin/mading` create, `POST /admin/mading/{id}` edit,
`DELETE /admin/mading/{id}`) lewat definer fn `admin.list_quiz/upsert_quiz_question/…` &
`admin.list_mading/upsert_mading_block/…`, dan **ekspor laporan SIM-19** — `GET /admin/reports/sessions.csv`
(→ `admin.session_results_export()`; respons `text/csv` non-JSON pertama, baris sesi selesai tanpa PII),
dan **kode misi SIM-42** — rotasi kode unlock reallife (`GET /admin/missions` → `admin.list_missions()`;
`POST /admin/missions/{code}` → `admin.set_mission_redeem_code()`; rotate-only, last-write-wins, actor =
`admin.user_id` diteruskan sebagai `$3::uuid`, nilai `redeem_code` TAK PERNAH di-log)
— semuanya membuka pool asyncpg **fail-soft** yang SAMA ke
Supabase sebagai role `metrics_reader` (`api/metrics_db.py`). **SIM-17/18 melebarkan `metrics_reader`
dari read-only ke baca + TULIS admin-gated** (capture/delete + quiz/mading upsert/delete lewat definer
fn `VOLATILE`); role tetap TANPA privilege tabel langsung, tapi blast radius `METRICS_DB_URL` naik.
**Kontrak error SIM-18 (penting):** `_call_definer` memetakan RAISE apa pun → 503, jadi validasi input
= 422 di boundary Pydantic (SEBELUM RPC) dan not-found/konflik = RETURN `{ok:false,reason}` terstruktur
(bukan RAISE) yang route petakan ke 404/409. Pool gagal-aman: DB mati/salah-konfig/lambat → endpoint
503, TAK PERNAH menjatuhkan `/token` atau `/health`. Jangan bawa DB ke jalur voice/token.

## Menjalankan & memverifikasi

```bash
cd apps/backend
uv sync
cp .env.example .env          # isi kredензial (lihat daftar env di .env.example)

# dua terminal:
uv run python voice_worker/voice_agent.py dev         # worker (registrasi agent_name)
uv run uvicorn api.server:app --port 8000 --reload    # token server

# test (API + logika worker dengan objek palsu). Tak butuh jaringan/Supabase/Google nyata.
uv run pytest
```
Catatan: tes preflight CORS gagal bila `.env` lokal men-set `CORS_ALLOW_ORIGIN` (dibaca saat
impor). Jalankan `CORS_ALLOW_ORIGIN= uv run pytest` untuk suite bersih.

Verifikasi live: jalankan `apps/web` dengan `VITE_TRANSPORT=livekit` +
`VITE_TOKEN_ENDPOINT=http://localhost:8000`, pilih skenario, bicara/ketik.
Log worker (`koperasi.*`) mencetak observer, fase, keputusan direktur (`direktur -> '<raw>'
(dipakai: …)`), dan giliran (`giliran -> <key>`) — pakai untuk debug.
Input mic sulit di-headless; jalur teks bisa di-drive dengan Playwright.

## Struktur

```
api/server.py                 POST /token (+ /health) — digerbangi JWT + rate-limit
api/auth.py                   verifikasi JWT Supabase (JWKS/ES256) → dependency FastAPI
api/ratelimit.py              token-bucket per-user untuk /token (429)
tests/                        pytest: verifier + endpoint + rate-limit (uv run pytest)
voice_worker/                 (impor top-level, TANPA prefiks `voice_worker.` — invarian pytest)
  voice_agent.py              entry TIPIS: AgentServer → pilih runner per skenario
  settings.py                 SATU-SATUNYA pembaca env Google + nama model + tuning RAT
  scenarios.py                REGISTRY: semua skenario + spec drift/auditor/RAT/mentor
  schemas.py                  validasi gagal-aman output auditor
  prompts/*.py                prompt persona, di-grounding ke ../../docs/scenarios.md
                              (+ rat_meja.py: aturan "satu mulut" RAT)
  gemini/                     client.py (genai.Client, RealtimeModel) · json_call.py
  evaluation/                 observer.py (L2) · auditor.py (L3) · mentor.py (Petunjuk)
  runtime/                    publisher (sinyal ke FE) · lifecycle (akhir sesi) · drift ·
                              rpc · tasks — dipakai kedua runner
  single_npc/runner.py        skenario 1–3: satu AgentSession Gemini Live
  rat/                        skenario 4: runner · discussion · director · listener ·
                              npc · floor · connection
```

Keempat skenario (Tutorial, Kredit Macet, Keanggotaan Fiktif, RAT) sudah
terpasang penuh di `scenarios.py`. Prompt persona di-grounding ke dokumen
skenario `docs/scenarios.md` (bukan lagi placeholder).

## Arsitektur: model state tiga lapis (PRD §6)

1. **Lapisan 1 — nada NPC real-time**: murni via system prompt + ChatContext.
   Tanpa state-tracking. Ada di semua skenario.
2. **Lapisan 2 — observer drift**: `evaluation/observer.py` + `runtime/drift.py`. Panggilan Gemini asinkron
   non-blocking menilai tiap giliran pemain (escalate/neutral/deescalate);
   `DriftTracker` → level 0/1/2 (streak). Level dipublish ke FE via participant
   attribute `drift_level`. Level 2 → force quit. Hanya skenario ber-`drift`.
3. **Lapisan 3 — AI Auditor**: `evaluation/auditor.py`. Model auditor sekali di akhir sesi,
   baca transkrip penuh + taksonomi + grounding → JSON (klasifikasi + skor +
   narasi). Hanya skenario ber-`auditor`. Tutorial pakai hasil terskrip.

**Tiga jalur akhir sesi** (PRD §6): `manual` (RPC `end_session`), sinyal Level 1
(attribute `drift_level=1`, FE menonjolkan tombol), `force_quit_level_2` (agent
memicu otomatis → data message `session_ended`). `runtime/lifecycle.py` menjamin SATU
hasil per sesi: jalur yang datang belakangan menerima hasil yang sama (auditor tak
pernah jalan dua kali).

## Fitur Petunjuk (mentor kontekstual — menggantikan "Tanya Mentor", PRD §9)

`evaluation/mentor.py`. RPC `petunjuk` → Gemini membaca transkrip + `mentor_brief`
skenario → satu saran langkah berikutnya (JSON `{"hint": ...}`). DI LUAR
ChatContext dialog (seperti observer/auditor) → tak mengubah percakapan. Guardrail
prompt: hanya saran yang bisa dilakukan LEWAT percakapan (bukan aksi fisik),
dorong ke solusi, tidak berulang, izinkan mekanik in-game "Periksa Dokumen".
Untuk skenario berfase (RAT), `_petunjuk` mengirim `phase_context` (fase + tombol
aksi berikutnya) agar mentor mengarahkan pemain pindah tugas secara mulus.
Gagal-aman: error → hint fallback. Ada di SEMUA skenario (tiap `Scenario` punya
`mentor_brief`).

## Skenario = data, bukan kode

Semua skenario didefinisikan di `scenarios.py` sebagai `Scenario` dataclass.
Menambah/mengubah skenario TIDAK perlu menyentuh `voice_agent.py`.

- `drift: DriftSpec | None` — None → tanpa observer (tutorial).
- `auditor: AuditorSpec | None` — None → hasil terskrip (`scripted_result`).
- `rat: RatSpec | None` — ada → alur dua-NPC + state machine fase (Skenario 4).
- `mentor_brief: str` — grounding fitur Petunjuk (tujuan + langkah skenario).

**Menambah skenario single-NPC**: tulis prompt di `prompts/`, tambah `Scenario`
dengan `drift`+`auditor`+`mentor_brief`, daftarkan di `_SCENARIOS`. Selesai —
semua wiring (observer, auditor, Petunjuk, tiga jalur akhir) sudah generik.

Itu untuk sisi backend. Untuk langkah **end-to-end lintas-stack** (katalog, seed DB,
konfig FE + skrip mock, `VALID_SCENARIOS`, CONTRACT, dan hitungan parity yang perlu
di-bump), lihat `../../docs/how-to-add-a-scenario.md`.

## RAT (dua NPC) — arsitektur "Telinga ≠ Mulut" (`rat/`)

Telinga dipisah dari mulut, supaya NPC yang salah tak pernah menjawab duluan:
- **Listener** (`rat/listener.py`): `google.STT` (id-ID, `detect_language=False`) pada mic
  pemain — tanpa LLM, tak pernah menjawab. Debounce potongan FINAL, barge-in dari INTERIM
  berteks, proteksi echo 3 dtk, dan **mempublish transkripsi pemain** ke FE.
- **NPC** (`rat/npc.py`): tiap persona = `AgentSession` Gemini Live sendiri dengan
  `audio_input=False, text_input=False` → hanya bicara saat `generate_reply()` dipanggil.
  Suara terikat ke sesi sejak konstruksi (tak pernah ditukar). Host (pemimpin Fase 1,
  Ibu Sri) memakai `ctx.room`; Pak Darma participant TERPISAH `npc-pak-darma` via
  `rat/connection.py` (dua track mic dari satu participant tidak dirender klien).
- **Discussion** (`rat/discussion.py`): transkrip bersama, mirror ucapan ke `chat_ctx`
  NPC lain (`[Nama berbicara] …`, role user), rantai giliran, fase, giliran terjadwal.
- **Direktur** (`rat/director.py`): LLM kecil memilih pembicara berikutnya; guard keras
  di kode. Nama NPC disebut tepat satu → dipilih deterministik tanpa direktur.
- **Watak persona terkunci** (prompt): Darma selalu bela kepentingannya, Sri selalu bela
  anggota kecil + prosedur. `domain` & `director_hint` di `scenarios.py` dibaca direktur.
- **Fase**: RPC `advance_phase` → `Discussion.advance_phase()` (lock, idempoten; hentikan
  suara & tunggu lantai kosong dulu) → `update_instructions` kedua NPC + attribute `phase`.
  Fase 2 = giliran terjadwal Pak Darma (`entry_line`).
- RPC didaftarkan di KEDUA koneksi (FE mengirim RPC ke participant remote pertama).
- Spec lengkap + invarian I1–I12: dokumen "Telinga ≠ Mulut" (milik pemilik proyek).

## GOTCHAS penting (pelajaran nyata — jangan diulang)

1. **`livekit-agents` 1.8 memakai `AgentServer` + `@server.rtc_session(agent_name=...)`
   + `cli.run_app(server)`** — BUKAN pola lama `WorkerOptions(entrypoint_fnc=...)`.
   PRD ditulis sebelum perubahan ini.
2. **`asyncio.create_task` WAJIB disimpan referensinya.** Event loop hanya
   memegang weak reference → task bisa di-GC sebelum selesai. Observer sempat
   "acak tidak jalan" karena ini. Semua task latar lewat `runtime/tasks.BackgroundTasks`.
3. **RAT: ucapan pemain BUKAN conversation item sesi NPC.** Teks pemain masuk lewat
   `update_chat_ctx` (tak memancarkan `conversation_item_added`). Observer RAT dipasang
   di `Discussion.add_transcript_listener`, bukan event sesi. Jalur suara (Listener) dan
   teks (RPC `send_text`) sama-sama masuk ke `Discussion.on_user_said`.
4. **RPC hanya bisa setelah agent join** (~12–19 dtk pertama, saat sapaan muncul).
   Kirim RPC sebelum itu → "Agent belum tersambung". FE sebaiknya menunggu NPC
   menyapa. (Kandidat pengerasan: nonaktifkan input sampai greeting.)
5. **JANGAN `session.update_agent()` / membuat ulang Agent untuk ganti NPC atau fase.**
   Satu NPC = satu sesi = satu suara, seumur sesi (bug lama: interupsi Pak Darma
   bersuara Ibu Sri saat persona ditukar di satu agent). Barge-in RAT WAJIB dua langkah:
   batalkan rantai DAN `interrupt()` semua sesi — `await handle` dibungkus
   `asyncio.shield`, membatalkan rantai saja tidak menghentikan suara.
6. **Nama model = env** (`GEMINI_*_MODEL`, dibaca di `settings.py`). Jangan hardcode.
   Cloud STT memakai ADC/`GOOGLE_APPLICATION_CREDENTIALS`, BUKAN `GOOGLE_API_KEY`.
   `google.STT` default `detect_language=True` — WAJIB `False` (transkrip meleset ke
   Korea/Jepang → direktur salah pilih). Realtime model tak punya `session.say()` tanpa
   TTS: kalimat terskrip lewat `generate_reply(instructions="Ucapkan PERSIS …")`.
7. **Observer, Auditor & mentor gagal-aman**: kalau panggilan LLM error, observer
   → "neutral", auditor → fallback netral, mentor → hint fallback. Jangan biarkan
   error menjatuhkan sesi.
8. **Mic non-fatal di FE**: kegagalan mic tak boleh menutup sesi (teks fallback).

## Kredensial

Semua di `.env` (gitignored). Butuh: LiveKit Cloud, Google AI Studio (`GOOGLE_API_KEY`)
atau Vertex AI, dan kredensial GCP (ADC) dengan Cloud Speech-to-Text API aktif untuk
RAT. Lihat `.env.example`. Var Azure tidak dipakai worker lagi.

## Konvensi

- Python 3.12, `uv`. Type hints. `from __future__ import annotations`.
- Logging via `logging.getLogger("koperasi.*")`. Log observer/fase sudah ada —
  pertahankan saat menambah fitur, sangat membantu debug live.
- Bahasa Indonesia untuk komentar & prompt (konsisten dengan proyek).
