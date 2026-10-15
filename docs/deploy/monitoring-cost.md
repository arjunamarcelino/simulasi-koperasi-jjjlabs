# Monitoring, Logging & Cost Guardrails (SIM-30)

Beri pemilik berikut visibilitas + kendali biaya. Empat layanan ter-meter: GCP, Azure
OpenAI, Azure Speech, LiveKit Cloud. Semua angka $ = tautan ke halaman harga live
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
- [ ] **Alert worker-crash** (log-based metric di journald VM / Cloud Logging).
- [ ] **Alert readiness** pada `textPayload=~"BELUM dikonfigurasi"` → redeploy yang
      menjatuhkan env akan memberi tahu.
- [ ] **Cost guardrails bersenjata (bukan sekadar alert):**
  - GCP **Spend Cap** (2026 — auto-pause nyata untuk Cloud Run) + budget alert.
    https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps
  - Cloud Run `--max-instances=1` + `--concurrency` + `--timeout` (batas keras; juga
    backstop anon-flood — lihat `production-config.md` §4).
  - Azure OpenAI **TPM quota** + `max_tokens` ketat (budget rate dihitung dari
    `max_tokens` + estimasi prompt). https://learn.microsoft.com/azure/foundry/openai/quotas-limits
  - Azure Cost Management budget + Action Group (auto-stop/scale-down).
    https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets
  - **Batas waktu sesi keras di worker** — tuas anti-biaya-liar terbesar untuk app
    voice ber-meter; pastikan aktif sebelum user nyata.
  - LiveKit: `emptyTimeout`/`maxParticipants`/`delete_room_on_close` (stop metering saat
    sesi berakhir). https://docs.livekit.io/agents/logic/sessions/

## 3. Setelah go-live (tuning — butuh trafik nyata) `[day-2]`

- Alert p95/p99 latency; 429-rate jalur Azure (indikator-awal biaya); saturasi
  instance→max-instances.
- Dashboard KPI (LiveKit mengemit mayoritas via `metrics_collected`/`SessionReport`):
  - sesi konkuren / room aktif
  - **distribusi durasi sesi** (ekor panjang = pembunuh biaya)
  - menit STT + karakter TTS per sesi
  - **blended cost-per-session** (unit ekonomi headline)
  - error rate (5xx, worker crash, 429 provider, reconnect LiveKit)

## 4. Catatan biaya per layanan (lihat halaman harga live)

| Layanan | Meter | Pengendali |
|---|---|---|
| GCP Cloud Run | per-request / instance-time | `--max-instances`, Spend Cap, request-based billing |
| GCE VM (worker) | per jam VM | right-size (`e2-standard-4`), CUD, matikan saat idle |
| Azure OpenAI | token (TPM) | quota TPM + `max_tokens` |
| Azure Speech | STT per-jam audio; TTS per-karakter | batasi panjang sesi + volume karakter |
| LiveKit Cloud | per-detik (min 10s) + bandwidth downstream $/GB | timeouts + batas sesi worker |

Harga: GCP https://cloud.google.com/run/pricing , https://cloud.google.com/compute/all-pricing ·
Azure Speech https://azure.microsoft.com/pricing/details/speech/ ·
LiveKit https://livekit.io/pricing · observability https://docs.livekit.io/agents/observability/

## Referensi
- Cloud Monitoring alert: https://docs.cloud.google.com/monitoring/alerts
- `README.md` Go/No-Go (monitoring-armed), `production-config.md` §4 (anti-abuse)
