# Koperasi Backend — token server + voice agent

Backend & AI pipeline untuk Koperasi Simulator. Voice penuh (Azure STT + Azure OpenAI
`gpt-5-mini` + Azure TTS). **Keempat skenario** terpasang: Tutorial, Kredit Macet,
Keanggotaan Fiktif, dan RAT (dua NPC + state machine fase) — dengan observer drift
(Lapisan 2), AI Auditor (Lapisan 3), dan fitur **Petunjuk** (mentor kontekstual).

> Dokumen lebih dalam (baca ini dulu untuk detail): **[`CLAUDE.md`](./CLAUDE.md)**
> (arsitektur + panduan mengedit agent + 8 GOTCHAS), **[`CONTRACT.md`](./CONTRACT.md)**
> (kontrak wire FE↔BE, referensi REST lengkap + status code). Desain produk:
> `../../docs/backend-prd.md`. Deploy: `../../docs/deploy/`.

## Dua proses, satu project `uv`

- **`api/server.py`** — FastAPI. Verifikasi JWT Supabase (`api/auth.py`), lalu mint
  LiveKit token + dispatch agent (`POST /token`), rate-limited per-user (`api/ratelimit.py`).
  Juga `GET /health` dan seluruh `GET/POST/DELETE /admin/*`.
- **`voice_worker/voice_agent.py`** — worker `livekit-agents` **1.6.5**. Satu proses
  menangani SEMUA skenario & persona: STT → LLM dialog → TTS.

Keduanya tidak saling bicara langsung — bertemu lewat **LiveKit Cloud** berdasarkan
`LIVEKIT_AGENT_NAME` (worker & token server **wajib** memakai nama yang sama). Jalur
voice/token **tanpa database**; satu-satunya jalur DB adalah `/admin/*` (pool asyncpg
fail-soft sebagai role `metrics_reader`, `api/metrics_db.py` — DB mati → `/admin/*` 503,
`/token` & `/health` tetap jalan).

## Setup & jalankan

```bash
cd apps/backend
uv sync
cp .env.example .env            # isi kredensial (daftar var lengkap ada di .env.example)

# dua terminal:
uv run python voice_worker/voice_agent.py dev        # worker (dev); prod = `start`
uv run uvicorn api.server:app --port 8000 --reload   # token server
```

Smoke `POST /token` — **butuh `Authorization: Bearer <supabase-jwt>`** (SIM-4, digerbangi
JWT; tanpa header → 401):

```bash
curl -XPOST localhost:8000/token \
  -H 'authorization: Bearer <supabase-jwt>' \
  -H 'content-type: application/json' \
  -d '{"scenario_id":"tutorial-koperasi-konsumen"}'
```

Tes: `uv run pytest` (tak butuh jaringan/Supabase nyata). Lint ad hoc: `ruff check`
(ruff ter-konfigurasi, py312; belum di-wire ke script).

## Klien uji

- **Game nyata:** `apps/web` dengan `VITE_TRANSPORT=livekit` + `VITE_TOKEN_ENDPOINT=http://localhost:8000`.
- **Admin dashboard:** `apps/admin` (konsumen `/admin/*`).

## Struktur

```
api/
  server.py       POST /token + GET /health + semua /admin/*
  auth.py         verifikasi JWT Supabase (JWKS/ES256) → dependency FastAPI
  ratelimit.py    token-bucket per-user untuk /token (429)
  metrics_db.py   pool asyncpg fail-soft ke Supabase sebagai metrics_reader (jalur DB admin)
voice_worker/
  voice_agent.py  entrypoint agent + RatAgent + wiring semua lapisan
  scenarios.py    REGISTRY tunggal: skenario + spec drift/auditor/RAT/mentor
  observer.py     Lapisan 2 drift (gpt-5-mini async) + DriftTracker
  auditor.py      Lapisan 3 AI Auditor (gpt-5.4) → JSON
  mentor.py       fitur Petunjuk: hint kontekstual (gpt-5-mini) → JSON
  schemas.py      skema pydantic (validasi fail-safe JSON Auditor)
  prompts/*.py    system prompt persona (di-grounding ke ../../docs/scenarios.md)
tests/            pytest (13 file): auth, token, rate-limit, auditor-parse, admin/*, dll
Dockerfile        multi-stage, dua target (api, worker); + docker-compose.yml
```

Menambah skenario single-NPC: tulis prompt di `prompts/`, tambah `Scenario`
(`drift`+`auditor`+`mentor_brief`) di `scenarios.py`, daftarkan — wiring sudah generik
(lihat `CLAUDE.md` → "Skenario = data, bukan kode").

## Env & kredensial

Semua di `.env` (gitignored); daftar lengkap + catatan di `.env.example`. Garis besar:
LiveKit Cloud (`LIVEKIT_*`, termasuk `LIVEKIT_AGENT_NAME`), Azure OpenAI (2 deployment:
`gpt-5-mini` dialog + `gpt-5.4` auditor), Azure Speech (`eastus2`), `CORS_ALLOW_ORIGINS`,
verifikasi JWT Supabase (`SUPABASE_JWKS_URL`/`_ISSUER`/`_AUD` — PUBLIC), dan admin DB
(`METRICS_DB_URL` sebagai `metrics_reader`, `METRICS_DB_SSL`). Kebijakan secret + rotasi
produksi: `../../docs/deploy/production-config.md`.

## Kontainer & deploy

`docker compose up --build` (api `:8000` + worker). Build per-target:
`docker build --target api .` / `--target worker .`. Runbook deploy:
`../../docs/deploy/backend-containers.md` dan `../../docs/deploy/gcp-backend.md`.

## Konvensi

Python 3.12, `uv`, type hints, `from __future__ import annotations`. Logging
`logging.getLogger("koperasi.*")` (log observer/fase = permukaan debug live).
Komentar & prompt dalam Bahasa Indonesia.
