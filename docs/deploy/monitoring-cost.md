# Monitoring, Logging & Cost Guardrails (SIM-30)

Beri pemilik berikut visibilitas + kendali biaya. Tiga layanan ter-meter: GCP (Cloud Run, VM,
Cloud STT), Gemini API (ditagih ke billing account project GCP yang sama), LiveKit Cloud. Semua angka $ = tautan ke halaman harga live
(bukan di-hardcode — harga sering berubah).

> **Prinsip:** apa pun yang mencegah *gagal-senyap* atau *biaya meledak* = **sebelum
> go-live**; apa pun yang butuh trafik nyata untuk di-threshold = **day-2**.

## 1. Logs — di mana & cara baca `[day-2]`

| Komponen | Lokasi | Cara baca |
|---|---|---|
| Token server (Cloud Run) | Cloud Logging | console → Logs Explorer, atau `gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' --limit 20 --freshness=1h` |
| Voice worker (GCE VM) | journald | `journalctl -u koperasi-worker -n 100 --no-pager` |
| Readiness token server | startup log | `gcloud logging read 'textPayload=~"BELUM dikonfigurasi|belum lengkap"'` — ada = env kurang |

Pertahankan logger `koperasi.*` (observer/fase) — itu permukaan debug live
(`apps/backend/CLAUDE.md`).

## 2. Sebelum go-live (BLOCKING — masuk Go/No-Go) `[deploy-critical]`

- [ ] **Uptime check yang menguji `/token`** (bukan hanya `/health`, yang config-blind
      dan selalu 200). Minimal assert `/token` → 401 (bukan 500); lebih baik synthetic
      ber-JWT-test assert 200+token.
      ```bash
      gcloud monitoring uptime list-configs
      ```
- [ ] **Alert 5xx-rate** pada token server (menangkap env hilang saat runtime).
- [ ] **Alert worker-crash** (log-based metric di journald VM / Cloud Logging) + health
      check `:8081` worker (liveness proses, framework livekit-agents).
- [ ] **Alert readiness** pada `textPayload=~"BELUM dikonfigurasi"` → redeploy yang
      menjatuhkan env akan memberi tahu.
- [ ] **Cost guardrails bersenjata (bukan sekadar alert):**
  - GCP **Spend Cap** (2026 — auto-pause nyata untuk Cloud Run) + budget alert.
    https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps
  - Cloud Run `--max-instances=1` + `--concurrency` + `--timeout` (batas keras; juga
    backstop anon-flood — lihat `production-config.md` §4).
  - Gemini API: **rate limit per tier** (RPM/TPM per model) + `max_output_tokens` ketat pada
    panggilan JSON (`voice_worker/gemini/json_call.py`; direktur RAT sudah `max_output_tokens=10`).
    https://ai.google.dev/gemini-api/docs/rate-limits
  - Budget alert GCP di atas **juga** menghitung Gemini API + Cloud STT (satu billing account) —
    verifikasi apakah Spend Cap ikut menghentikan Gemini API; jangan diasumsikan.
  - **Batas durasi sesi — tuas anti-biaya-liar terbesar, TAPI belum ada di kode.**
    ⚠️ `voice_worker/` (`single_npc/runner.py`, `rat/runner.py`) saat ini TIDAK punya cap durasi/idle sesi.
    Sebelum user nyata, tegakkan batas via **kontrol room LiveKit** (yang sudah ada):
    `emptyTimeout`, `maxParticipants`, `delete_room_on_close`, dan `user_away_timeout`
    agen — plus pertimbangkan menambah watchdog `asyncio` sisi-worker (follow-up).
    https://docs.livekit.io/agents/logic/sessions/

## 3. Setelah go-live (tuning — butuh trafik nyata) `[day-2]`

- Alert p95/p99 latency; 429-rate Gemini API (indikator-awal biaya/kuota); saturasi
  instance→max-instances.
- Dashboard KPI (LiveKit mengemit mayoritas via `metrics_collected`/`SessionReport`):
  - sesi konkuren / room aktif
  - **distribusi durasi sesi** (ekor panjang = pembunuh biaya)
  - menit audio Gemini Live + menit Cloud STT (RAT) per sesi
  - **blended cost-per-session** (unit ekonomi headline)
  - error rate (5xx, worker crash, 429 provider, reconnect LiveKit)

## 4. Catatan biaya per layanan (lihat halaman harga live)

| Layanan | Meter | Pengendali |
|---|---|---|
| GCP Cloud Run | per-request / instance-time | `--max-instances`, Spend Cap, request-based billing |
| GCE VM (worker) | per jam VM | right-size (`e2-standard-4`), CUD, matikan saat idle |
| Gemini Live (NPC suara) | token audio + teks masuk/keluar | batasi durasi sesi (§2); rate limit tier |
| Gemini (observer/auditor/mentor/direktur) | token teks | `max_output_tokens`; model `flash-lite` untuk panggilan sering |
| Cloud STT (pendengar RAT) | per menit audio (hanya skenario RAT) | batasi durasi sesi RAT |
| LiveKit Cloud | per-detik (min 10s) + bandwidth downstream $/GB | timeout room LiveKit (`emptyTimeout`/`user_away_timeout`); cap durasi worker = follow-up |

Harga: GCP https://cloud.google.com/run/pricing , https://cloud.google.com/compute/all-pricing ·
Gemini API https://ai.google.dev/gemini-api/docs/pricing · Cloud STT https://cloud.google.com/speech-to-text/pricing ·
LiveKit https://livekit.io/pricing · observability https://docs.livekit.io/agents/observability/

## Referensi
- Cloud Monitoring alert: https://docs.cloud.google.com/monitoring/alerts
- `README.md` Go/No-Go (monitoring-armed), `production-config.md` §4 (anti-abuse)
