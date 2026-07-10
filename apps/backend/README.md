# Koperasi Backend — token server + voice agent

Backend & AI pipeline untuk Koperasi Simulator (PRD `apps/backent-prd.md`).
Slice pertama: **Skenario 1 (Tutorial)**, voice penuh (Azure STT + Azure OpenAI
`gpt-5-mini` + Azure TTS), tanpa observer drift / AI Auditor (PRD §7.1).

Dua proses terpisah, satu project `uv`:
- `api/server.py` — FastAPI, `POST /token` (mint token + dispatch agent).
- `voice_worker/voice_agent.py` — worker `livekit-agents` (STT→LLM→TTS per NPC).

## Setup

```bash
cd apps/backend
uv sync
cp .env.example .env   # lalu isi kredensial
```

## Jalankan (dua terminal)

```bash
# 1) Worker agent — registrasi agent_name ke LiveKit Cloud
uv run python voice_worker/voice_agent.py dev

# 2) Token server
uv run uvicorn api.server:app --port 8000 --reload
```

Smoke test token:
```bash
curl -XPOST localhost:8000/token \
  -H 'content-type: application/json' \
  -d '{"scenario_id":"tutorial-koperasi-konsumen"}'
```

## Klien uji

`apps/web-sementara` dengan `VITE_TRANSPORT=livekit` dan
`VITE_TOKEN_ENDPOINT=http://localhost:8000`. Pilih **Tutorial**, izinkan mic,
bicara dengan Ibu Rumah Tangga, lalu klik **Bayar & Daftar**.

## Cakupan

Kini hanya Skenario 1. `voice_worker/scenarios.py` adalah registry — persona,
voice, dan (nanti) observer drift + AI Auditor untuk Skenario 2–4 tinggal
ditambahkan di situ.
