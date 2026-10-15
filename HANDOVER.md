# Handover Packet — Simulasi Koperasi (SIM-35)

> Satu dokumen untuk serah-terima v1 (16 Okt 2026). Tujuan: pemilik baru bisa
> mengambil alih **dari nol** hanya dengan paket ini + dokumen yang ditautkannya.
> Semua tautan menunjuk dokumen yang **dipertahankan** (bukan dokumen kerja yang
> dihapus saat serah-terima). Daftar keterbatasan & risiko ada di `LIMITATIONS.md`.

**Terakhir diverifikasi: 2026-10-16**

---

## 1. Serah-terima kepemilikan & rotasi kredensial

**Prinsip rahasia (jangan dilanggar):**
- Rahasia **tidak pernah** masuk repo, CI, atau bundle FE.
- Semua rahasia disimpan di **GCP Secret Manager**, direferensikan Cloud Run via `--set-secrets`.
- Default **pin versi `:N`**; **rotasi = buat versi secret baru + cycle instance**. `:latest` hanya untuk rotasi zero-touch dan tetap butuh instance cycle.
- Service account **per-service** (bukan default compute SA); grant `roles/secretmanager.secretAccessor` **di resource secret**, bukan project-wide.
- Sumber kebenaran daftar var tetap `apps/*/.env.example` (dipertahankan di repo).

**Dua pengecualian "bukan di Secret Manager" yang mudah terlewat:**
- **Turnstile secret** → hidup di **Supabase Auth → CAPTCHA**, bukan env backend.
- Password **`metrics_reader`** → di-set manual via SQL; username pooler wajib `metrics_reader.<project-ref>` (port 5432, `verify-full`).

**Tabel kepemilikan & rotasi** (isi kolom Owner sebelum serah-terima):

| Layanan | Var (publik / rahasia) | Di mana nilainya hidup | Jalur rotasi | Owner |
|---|---|---|---|---|
| **LiveKit Cloud** | `LIVEKIT_URL`, `LIVEKIT_AGENT_NAME` (publik) / `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (rahasia) | Rahasia → Secret Manager; URL + agent-name = env di token server **dan** worker (harus byte-identik) | versi secret baru + cycle instance | `<owner>` |
| **Azure OpenAI** | endpoint / api-version / nama deployment (`dialogue`, `auditor`) / `AZURE_OPENAI_API_KEY` (rahasia) | Worker env; key → Secret Manager | idem | `<owner>` |
| **Azure Speech** | `AZURE_SPEECH_REGION` / `AZURE_SPEECH_KEY` (rahasia) | Worker env; key → Secret Manager | idem | `<owner>` |
| **GCP** | SA per-service; `secretAccessor` di resource secret | GCP project: Cloud Run token server + GCE VM worker; rahasia di Secret Manager | IAM di scope resource, bukan project-wide | `<owner>` |
| **VPS (frontend)** | tidak ada secret; nginx + TLS (certbot) | VPS in-house; sertifikat TLS di VPS | `certbot renew`; rollback deploy = tukar symlink | `<owner>` |
| **Domain / DNS** | `app.`/`admin.` → IP VPS; `api.` → IP GCP LB | DNS provider (eksternal) | ubah di DNS provider; **wajib resolve sebelum** certbot + build (urutan bake CSP) | `<owner>` |
| **Supabase** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publik) / `service_role` Supabase, `METRICS_DB_URL` (rahasia) + prasyarat dashboard | anon key/URL → bundle FE (build-time); rahasia → Secret Manager; prasyarat (hook, anon sign-in, Turnstile secret, seed admin) → Supabase Studio | FE: rebuild; backend: Secret Manager + cycle; `metrics_reader`: SQL manual | `<owner>` |
| **Cloudflare Turnstile** | `VITE_TURNSTILE_SITE_KEY` (publik) / Turnstile **secret** | site key → bundle FE; **secret → Supabase Auth/CAPTCHA, bukan env backend** | site key: rebuild; secret: set di Supabase | `<owner>` |

> Detail env lengkap & CORS/CSP/DNS: lihat `docs/deploy/production-config.md`. Prosedur
> rotasi/redeploy/rollback operasional: lihat `docs/deploy/README.md` (Runbook Day-2).

---

## 2. Ringkasan biaya & estimasi run bulanan

Empat layanan ter-meter: **GCP**, **Azure OpenAI**, **Azure Speech**, **LiveKit Cloud**.
Harga **tidak di-hardcode** (sering berubah) — selalu cek halaman harga live. Yang durable
adalah *pengendali biaya* dan *metrik unit*.

| Layanan | Meter | Pengendali biaya |
|---|---|---|
| GCP Cloud Run (token server) | per-request / instance-time | `--max-instances=1`, Spend Cap, request-based billing |
| GCE VM (voice worker) | per jam VM | right-size (`e2-standard-4`), CUD, matikan saat idle |
| Azure OpenAI | token (TPM) | quota TPM + `max_tokens` ketat |
| Azure Speech | STT per-jam audio; TTS per-karakter | **batasi durasi sesi** + volume karakter |
| LiveKit Cloud | per-detik (min 10s) + bandwidth downstream $/GB | timeout room (`emptyTimeout`/`user_away_timeout`); **cap durasi worker = follow-up** |

**Metrik unit headline:** *blended cost-per-session*. Ekor durasi sesi yang panjang =
pembunuh biaya (lihat `LIMITATIONS.md` A1 — belum ada cap durasi di kode).

**Rumus estimasi bulanan:**
```
biaya_bulanan ≈ (sesi/bulan × blended_cost_per_session) + biaya_tetap_VM
sesi/bulan   ≈ sesi_aktif_harian × 30
cost/session ≈ (LiveKit: detik × tarif) + (Azure STT: menit) + (Azure TTS: karakter)
                + (Azure OpenAI: token) + (GCP: amortisasi per-request)
```

**Contoh terhitung (ILUSTRATIF — ganti dengan angka nyata & tarif live):**
> Asumsi, per 16 Okt 2026: ~40 sesi aktif/hari (~1.200 sesi/bulan), durasi rata-rata
> ~8 menit/sesi. Pada `blended_cost_per_session ≈ $0,20` (ilustratif) →
> **variabel ≈ $240/bulan** + biaya tetap VM worker (`e2-standard-4`, per-jam) + Cloud Run
> (kecil pada `--max-instances=1`). **Ini estimasi; validasi dengan tarif live + unit
> ekonomi nyata** sebelum dipakai untuk anggaran.

Harga live: GCP `https://cloud.google.com/run/pricing`, `https://cloud.google.com/compute/all-pricing` ·
Azure Speech `https://azure.microsoft.com/pricing/details/speech/` · LiveKit `https://livekit.io/pricing`.
Panduan guardrail + alert biaya: `docs/deploy/monitoring-cost.md`.

---

## 3. Backlog terprioritaskan

Leftover Phase 2/3 + hal yang dipotong demi waktu. Pemilik baru boleh re-rank/tambah.

| Prioritas | Item | Asal |
|---|---|---|
| **P1** | Refleksi/feedback AI terpersonalisasi dari riwayat per-user | SIM-12 (Backlog, dulu Urgent) |
| **P1** | Tegakkan cap durasi/idle sesi di voice worker (guard biaya terbesar) — **belum ada di kode** | `monitoring-cost.md` §2; `LIMITATIONS.md` A1 |
| **P2** | Tambah skenario baru (BE persona + registry + FE config/mock) | SIM-11 + SIM-39 (dipotong) |
| **P2** | Live deploy + smoke test (belum pernah dijalankan nyata) | SIM-29 (dipotong) |
| **P3** | Poles aset UI (art, sprites, tilemap, ikon) | SIM-38 (dipotong) |
| **P3** | Panduan "cara menambah skenario" (FE + BE + CONTRACT) | SIM-34 |
| **P3** | Tulis README `apps/admin` | gap diketahui (`LIMITATIONS.md` A7) |

**Selesaikan jika masih terbuka saat serah-terima** (tugas persiapan handover, bukan backlog pasca-handover):
SIM-31 (pindahkan `docs/` ke version control + rapikan), SIM-36 (cleanup repo: `web-sementara`, `dist`/`.vite` ter-commit, glob packages, higiene `.gitignore`), SIM-37 (pass akhir `/code-review` + `/simplify`).

---

## 4. Indeks dokumen (hanya dokumen yang dipertahankan)

| Dokumen | Baca ini saat… |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | ingin gambaran sistem end-to-end + diagram runtime |
| [`README.md`](README.md) | setup lokal, struktur monorepo, perintah |
| [`LIMITATIONS.md`](LIMITATIONS.md) | perlu tahu keterbatasan, risiko, dan jebakan operasional |
| [`docs/deploy/README.md`](docs/deploy/README.md) | men-deploy / Go-No-Go / Runbook Day-2 |
| [`docs/deploy/production-config.md`](docs/deploy/production-config.md) | **otoritatif**: env, CORS/CSP, DNS, secret, prasyarat Supabase |
| [`docs/deploy/gcp-backend.md`](docs/deploy/gcp-backend.md) | deploy token server (Cloud Run) + worker (GCE VM) + LB/NEG + Secret Manager |
| [`docs/deploy/backend-containers.md`](docs/deploy/backend-containers.md) | build/jalankan kontainer backend |
| [`docs/deploy/frontend-vps.md`](docs/deploy/frontend-vps.md) | build + nginx + TLS untuk `app.`/`admin.` |
| [`docs/deploy/monitoring-cost.md`](docs/deploy/monitoring-cost.md) | logs, alert, guardrail biaya |
| [`docs/qa/manual-qa-regression-checklist.md`](docs/qa/manual-qa-regression-checklist.md) | menjalankan regresi QA manual |
| [`apps/db/RUNBOOK.md`](apps/db/RUNBOOK.md) | provisioning Supabase, migrasi, rollback DB |
| [`apps/db/DATA-MODEL.md`](apps/db/DATA-MODEL.md) | skema / ERD |
| [`apps/backend/CONTRACT.md`](apps/backend/CONTRACT.md) | kontrak wire FE↔BE |
| [`apps/backend/CLAUDE.md`](apps/backend/CLAUDE.md) | mengerjakan token server / voice worker |
| [`apps/web/README.md`](apps/web/README.md) | mengerjakan game/UI frontend |

---

## 5. Keterbatasan & risiko

Semua keterbatasan sistem terkirim, sharp edges operasional, dan katalog risiko regresi
ada di **[`LIMITATIONS.md`](LIMITATIONS.md)** — baca sebelum perubahan produksi pertama.
