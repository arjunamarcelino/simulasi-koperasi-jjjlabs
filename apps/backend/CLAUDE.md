# CLAUDE.md — Panduan Backend (Koperasi Simulator)

Panduan untuk AI agent yang memodifikasi backend. Baca ini dulu sebelum mengubah
kode. Untuk kontrak wire FE↔BE, lihat `CONTRACT.md`. Untuk desain produk, lihat
`../backent-prd.md` (PRD).

## Apa ini

Backend + AI pipeline game edukasi koperasi berbasis voice. Dua proses, satu
project `uv`:

- **`api/server.py`** — FastAPI. Hanya mint LiveKit token + dispatch agent
  (`POST /token`). Tanpa database.
- **`voice_worker/voice_agent.py`** — worker `livekit-agents` v1.6.5. Satu proses
  menangani SELURUH skenario & persona (PRD §2.1). STT (Azure) → LLM dialog
  (Azure OpenAI `gpt-5-mini`) → TTS (Azure).

Tidak ada database — seluruh state sesi in-memory, hidup selama room LiveKit
aktif (PRD §2.5, §8).

## Menjalankan & memverifikasi

```bash
cd apps/backend
uv sync
cp .env.example .env          # isi kredензial (lihat daftar env di .env.example)

# dua terminal:
uv run python voice_worker/voice_agent.py dev         # worker (registrasi agent_name)
uv run uvicorn api.server:app --port 8000 --reload    # token server
```

Verifikasi live: jalankan `apps/web-sementara` dengan `VITE_TRANSPORT=livekit` +
`VITE_TOKEN_ENDPOINT=http://localhost:8000`, pilih skenario, bicara/ketik.
Log worker (`koperasi.voice_agent`) mencetak observer & fase — pakai untuk debug.
Input mic sulit di-headless; jalur teks bisa di-drive dengan Playwright.

## Struktur

```
api/server.py                 POST /token (+ /health)
voice_worker/
  voice_agent.py              entrypoint agent + RatAgent + wiring semua lapisan
  scenarios.py                REGISTRY: semua skenario + spec drift/auditor/RAT
  observer.py                 Lapisan 2: drift (gpt-5-mini async) + DriftTracker
  auditor.py                  Lapisan 3: AI Auditor (gpt-5.4) → JSON
  prompts/*.py                system prompt persona (placeholder, di-grounding PRD)
```

## Arsitektur: model state tiga lapis (PRD §6)

1. **Lapisan 1 — nada NPC real-time**: murni via system prompt + ChatContext.
   Tanpa state-tracking. Ada di semua skenario.
2. **Lapisan 2 — observer drift**: `observer.py`. Panggilan `gpt-5-mini` asinkron
   non-blocking menilai tiap giliran pemain (escalate/neutral/deescalate);
   `DriftTracker` → level 0/1/2 (streak). Level dipublish ke FE via participant
   attribute `drift_level`. Level 2 → force quit. Hanya skenario ber-`drift`.
3. **Lapisan 3 — AI Auditor**: `auditor.py`. `gpt-5.4` sekali di akhir sesi,
   baca transkrip penuh + taksonomi + grounding → JSON (klasifikasi + skor +
   narasi). Hanya skenario ber-`auditor`. Tutorial pakai hasil terskrip.

**Tiga jalur akhir sesi** (PRD §6): `manual` (RPC `end_session`), sinyal Level 1
(attribute `drift_level=1`, FE menonjolkan tombol), `force_quit_level_2` (agent
memicu otomatis → data message `session_ended`).

## Skenario = data, bukan kode

Semua skenario didefinisikan di `scenarios.py` sebagai `Scenario` dataclass.
Menambah/mengubah skenario TIDAK perlu menyentuh `voice_agent.py`.

- `drift: DriftSpec | None` — None → tanpa observer (tutorial).
- `auditor: AuditorSpec | None` — None → hasil terskrip (`scripted_result`).
- `rat: RatSpec | None` — ada → alur dua-NPC + state machine fase (Skenario 4).

**Menambah skenario single-NPC**: tulis prompt di `prompts/`, tambah `Scenario`
dengan `drift`+`auditor`, daftarkan di `_SCENARIOS`. Selesai — semua wiring
(observer, auditor, tiga jalur akhir) sudah generik.

## RAT (dua NPC) — pola yang dipakai

Satu `RatAgent(Agent)`, dua persona (PRD §2.1: bukan proses/agent terpisah):
- **Prompt** ditukar per persona via `update_instructions()` (async).
- **Suara** ditukar via override `tts_node` → sintesis dengan TTS persona aktif.
- **Persona aktif** dipilih oleh: default per fase (`RatPhase.default_persona`)
  + heuristik penyebutan nama (`RatSpec.name_mentions`).
- **Fase**: RPC `advance_phase` menaikkan fase; publish attribute `phase`. Fase 2
  memicu interupsi terskrip (`session.say`) dari Pak Darma.

## GOTCHAS penting (pelajaran nyata — jangan diulang)

1. **`livekit-agents` v1.6.5 memakai `AgentServer` + `@server.rtc_session(agent_name=...)`
   + `cli.run_app(server)`** — BUKAN pola lama `WorkerOptions(entrypoint_fnc=...)`.
   PRD ditulis sebelum perubahan ini.
2. **`asyncio.create_task` WAJIB disimpan referensinya.** Event loop hanya
   memegang weak reference → task bisa di-GC sebelum selesai. Observer sempat
   "acak tidak jalan" karena ini. Lihat helper `_spawn` di `voice_agent.py`.
3. **`on_user_turn_completed` TIDAK menyala di jalur teks** (`generate_reply(user_input=...)`
   melewati turn-detection STT). Routing nama RAT karena itu dilakukan DI DUA
   tempat: hook `on_user_turn_completed` (suara) DAN RPC `send_text` (teks).
4. **RPC hanya bisa setelah agent join** (~12–19 dtk pertama, saat sapaan muncul).
   Kirim RPC sebelum itu → "Agent belum tersambung". FE sebaiknya menunggu NPC
   menyapa. (Kandidat pengerasan: nonaktifkan input sampai greeting.)
5. **`tts_node` mengumpulkan teks penuh sebelum sintesis** (agar routing suara
   pasti benar). Latency naik sedikit untuk balasan panjang; oke untuk 1–2 kalimat.
6. **Nama deployment model = env** (`AZURE_OPENAI_DEPLOYMENT_DIALOGUE` untuk
   dialog+observer, `AZURE_OPENAI_DEPLOYMENT_AUDITOR` untuk gpt-5.4). Jangan
   hardcode nama model.
7. **Observer & Auditor gagal-aman**: kalau panggilan LLM error, observer →
   "neutral", auditor → fallback netral. Jangan biarkan error menjatuhkan sesi.
8. **Mic non-fatal di FE**: kegagalan mic tak boleh menutup sesi (teks fallback).

## Kredensial

Semua di `.env` (gitignored). Butuh: LiveKit Cloud, Azure OpenAI (2 deployment:
gpt-5-mini + gpt-5.4), Azure Speech (region eastus2). Lihat `.env.example`.

## Konvensi

- Python 3.12, `uv`. Type hints. `from __future__ import annotations`.
- Logging via `logging.getLogger("koperasi.*")`. Log observer/fase sudah ada —
  pertahankan saat menambah fitur, sangat membantu debug live.
- Bahasa Indonesia untuk komentar & prompt (konsisten dengan proyek).
