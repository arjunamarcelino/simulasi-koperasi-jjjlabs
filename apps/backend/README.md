# Koperasi Backend — token server + voice agent

Backend & AI pipeline untuk Koperasi Simulator (PRD `apps/backent-prd.md`).
Voice penuh (Azure STT + Azure OpenAI `gpt-5-mini` + Azure TTS). **Keempat
skenario** terpasang: Tutorial, Kredit Macet, Keanggotaan Fiktif, dan RAT (dua
NPC + state machine fase) — lengkap dengan observer drift (Lapisan 2), AI Auditor
(Lapisan 3), dan fitur **Petunjuk** (mentor kontekstual). Detail arsitektur di
`CLAUDE.md`; kontrak wire FE↔BE di `CONTRACT.md`.

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
`VITE_TOKEN_ENDPOINT=http://localhost:8000`. Pilih skenario, izinkan mic
(opsional — teks juga jalan), lalu berinteraksi. Tombol **💡 Petunjuk** meminta
saran mentor kapan saja; tutorial ditutup lewat **Bayar & Daftar**, skenario lain
lewat **Keputusan Akhir**.

## Cakupan

Keempat skenario aktif. `voice_worker/scenarios.py` adalah registry tunggal —
persona, voice, spec drift/auditor/RAT, dan `mentor_brief` per skenario. Menambah
/mengubah skenario cukup di situ + prompt di `prompts/`; wiring (observer, auditor,
Petunjuk, tiga jalur akhir) sudah generik. Lihat `CLAUDE.md`.
