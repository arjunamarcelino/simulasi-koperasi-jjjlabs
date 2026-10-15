# Dokumentasi — Simulasi Koperasi

Indeks dokumen proyek. Folder `docs/` kini **version-controlled** (SIM-31).

> **Konvensi:** dokumen kerja berbantuan-AI (`brainstorms/`, `plans/`, `reviews/`,
> `solutions/`) **tidak di-commit** (di-ignore di `.gitignore`) — bersifat ephemeral.
> Konten durable-nya sudah disarikan ke dokumen yang di-commit (lihat di bawah).

## Isi `docs/`

| Dokumen | Isi |
|---|---|
| [`how-to-add-a-scenario.md`](how-to-add-a-scenario.md) | Panduan menambah skenario baru end-to-end (FE + BE + CONTRACT + katalog + DB) |
| [`backend-prd.md`](backend-prd.md) | PRD backend & AI pipeline (desain produk) |
| [`scenarios.md`](scenarios.md) | Definisi skenario — grounding untuk prompt persona |
| [`deploy/README.md`](deploy/README.md) | Indeks deploy + Go/No-Go + Runbook Day-2 |
| [`deploy/production-config.md`](deploy/production-config.md) | **Otoritatif**: env, CORS/CSP, DNS, secret, prasyarat Supabase |
| [`deploy/gcp-backend.md`](deploy/gcp-backend.md) | Cloud Run token server, GCE-VM worker, LB/NEG, Secret Manager, migrasi |
| [`deploy/backend-containers.md`](deploy/backend-containers.md) | Kontainerisasi backend (Dockerfile + compose) |
| [`deploy/frontend-vps.md`](deploy/frontend-vps.md) | Build + nginx + TLS untuk `app.`/`admin.` |
| [`deploy/monitoring-cost.md`](deploy/monitoring-cost.md) | Logs, alert sebelum go-live, guardrail biaya |
| [`qa/manual-qa-regression-checklist.md`](qa/manual-qa-regression-checklist.md) | Rencana QA manual + checklist regresi |

## Dokumen penting lain (di luar `docs/`)

| Dokumen | Isi |
|---|---|
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | Gambaran sistem end-to-end + diagram runtime (hub dokumen) |
| [`../HANDOVER.md`](../HANDOVER.md) | Paket serah-terima: kepemilikan + rotasi kredensial, biaya, backlog |
| [`../LIMITATIONS.md`](../LIMITATIONS.md) | Keterbatasan, risiko, dan sharp edges operasional |
| [`../README.md`](../README.md) | Intro proyek, struktur monorepo, perintah |
| [`../apps/backend/CLAUDE.md`](../apps/backend/CLAUDE.md) | Arsitektur backend + panduan mengedit agent |
| [`../apps/backend/CONTRACT.md`](../apps/backend/CONTRACT.md) | Kontrak wire FE↔BE |
| [`../apps/db/DATA-MODEL.md`](../apps/db/DATA-MODEL.md) · [`../apps/db/RUNBOOK.md`](../apps/db/RUNBOOK.md) | Skema/ERD · provisioning + migrasi DB |

Mulai dari [`../ARCHITECTURE.md`](../ARCHITECTURE.md) untuk orientasi menyeluruh.
