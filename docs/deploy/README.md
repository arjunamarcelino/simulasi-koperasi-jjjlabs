# Deployment & Ops — Simulasi Koperasi (indeks + runbook)

Set dokumentasi deploy untuk handover v1. **Hosting terpisah:** frontend di VPS
in-house, backend di GCP, DB+auth di Supabase, voice via LiveKit Cloud + Azure.
Bahasa Indonesia; perintah/istilah teknis Inggris. `<domain>` dan `<PLACEHOLDER>`
diganti nilai asli.

> Label: **[deploy-critical]** = jalur deploy-dari-nol · **[day-2]** = operasional lanjutan.

## Quickstart — deploy dari nol (6 langkah) `[deploy-critical]`

1. **Prasyarat:** VPS + sudo; proyek GCP; proyek Supabase; DNS `app./admin./api.`; putuskan `<domain>`.
2. [`production-config.md`](./production-config.md) → set semua env/secret; daftarkan hook Supabase + anon sign-in + secret Turnstile.
3. [`backend-containers.md`](./backend-containers.md) → `docker compose up --build` (cek paritas lokal).
4. [`gcp-backend.md`](./gcp-backend.md) → push image; deploy token server (`api.<domain>`); nyalakan GCE-VM worker; `supabase db push`.
5. [`frontend-vps.md`](./frontend-vps.md) → build web+admin dgn `api.<domain>` ter-bake; sajikan via nginx; TLS certbot.
6. **Go/No-Go** (di bawah) → jalankan checklist; E2E smoke (guest→voice, admin→dashboard). Umumkan.

## Dokumen

| Dokumen | Isi |
|---|---|
| [`production-config.md`](./production-config.md) | **Otoritatif**: matriks env, origin (CORS+CSP), DNS, secret, prasyarat Supabase |
| [`backend-containers.md`](./backend-containers.md) | Dockerfile + compose (file nyata di `apps/backend/`) |
| [`gcp-backend.md`](./gcp-backend.md) | Cloud Run token server, GCE-VM worker, LB+NEG, Secret Manager, migrasi |
| [`frontend-vps.md`](./frontend-vps.md) | Build + nginx + TLS + hardening untuk `app.`/`admin.<domain>` |
| [`monitoring-cost.md`](./monitoring-cost.md) | Logs, alert sebelum go-live, guardrail biaya |

## Arsitektur

```
Browser ──TLS──> app.<domain>     (VPS nginx → apps/web dist/)
            └──> admin.<domain>   (VPS nginx → apps/admin dist/)
        ──TLS──> api.<domain>     (GCP: LB+NEG → Cloud Run token server, 1 instance)
        ──wss──> LiveKit Cloud    (media + sesi agent)
Voice worker (GCE VM + systemd) ──outbound──> LiveKit; ──> Azure OpenAI + Azure Speech
api  ──/admin/* (metrics_reader)──> Supabase (Postgres 15); ──JWKS ES256──> Supabase (auth)
```
DNS: `app`/`admin` = A/AAAA → IP VPS; `api` = A/CNAME → IP LB (lihat `production-config.md` §2).

---

# Go/No-Go — cutover produksi `[deploy-critical]`

### Pra-cutover (STOP jika ada yang gagal)
- [ ] `https://api.<domain>` resolve & live **sebelum** build FE (urutan CSP-bake).
- [ ] DNS `app./admin./api.` resolve ke target benar (`dig +short …`).
- [ ] `supabase migration list --linked`: LOCAL == REMOTE baris-per-baris.
- [ ] `psql "$METRICS_DB_URL" -c 'select 1;'` sukses (username `metrics_reader.<project-ref>`).
- [ ] Supabase: hook `custom_access_token_hook` terdaftar; anon sign-in on; **secret Turnstile di-set**; password `metrics_reader` di-set; `public.admins` di-seed.
- [ ] `guard-secrets` hijau; `git grep --cached` tak menemukan assignment literal kunci `service_role` (var `SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_ROLE`, diikuti nilai) di luar `.env.example`. ⚠️ jangan tulis bentuk assignment itu di dokumen mana pun — guard mengecek nama var-nya tanpa pengecualian `*.md`.

### Backend live-ready (ini penjaga false-green)
- [ ] `curl $API/health` → 200. ⚠️ TIDAK cukup sendiri (health config-blind).
- [ ] `POST $API/token` tanpa auth → **401, bukan 500** (500 ⇒ JWKS/issuer/LiveKit belum di-set).
- [ ] Log startup TANPA peringatan readiness (`BELUM dikonfigurasi`).
- [ ] `LIVEKIT_AGENT_NAME` identik di token-server & worker:
  ```bash
  gcloud run services describe token-server --region <REGION> --format='value(spec.template.spec.containers[].env)' | grep -i LIVEKIT_AGENT_NAME
  gcloud compute ssh voice-worker --zone <ZONE> --command 'systemctl show koperasi-worker -p Environment | grep -i LIVEKIT_AGENT_NAME'
  ```
- [ ] Worker: `curl http://<worker>:8081/` → 200 (liveness proses, framework livekit-agents 1.6.5) **dan** log memuat registrasi job ke LiveKit (readiness). `:8081` dipakai MIG autohealing.
- [ ] CORS preflight dari origin prod meng-echo origin itu (bukan localhost):
  ```bash
  curl -s -D - -o /dev/null -X OPTIONS $API/token \
    -H 'Origin: https://app.<domain>' -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: authorization,content-type'
  # HARUS: Access-Control-Allow-Origin: https://app.<domain>
  ```

### Frontend live-ready
- [ ] `connect-src` di `app/dist` DAN `admin/dist` `index.html` memuat `https://api.<domain>`.
- [ ] Tepat satu CSP (meta); tak ada header CSP dari nginx; `nginx -t` lulus.
- [ ] TLS valid di kedua host; `certbot renew --dry-run` lulus; deploy-hook reload nginx.

### E2E (harus lulus live)
- [ ] **Path A (guest→voice):** buka `app.<domain>` → login anon → pilih skenario →
      `POST /token` 200 → worker join → sapaan NPC terdengar (~12–19 dtk). Tanpa
      pelanggaran CSP di console. Bicara/ketik satu giliran → NPC menjawab in-character.
- [ ] **Path B (admin):** buka `admin.<domain>` → login admin seeded → JWT decode
      `is_admin:true` → `GET /admin/me` 200 → dashboard `/admin/metrics` 200 (bukan 503)
      → ekspor `/admin/reports/sessions.csv` 200 text/csv.
- [ ] Probe negatif: unauth `/token` 401, non-admin 403, skenario salah 422, flood 429.

### Monitoring bersenjata (sebelum go-live)
- [ ] Uptime check menguji `/token` (bukan hanya `/health`); alert 5xx + worker-crash.
- [ ] GCP Spend Cap + budget; `--max-instances=1`; batas waktu sesi worker aktif; Azure TPM quota.

---

# Runbook Day-2 `[day-2]`

## Restart / redeploy / rollback
- **Token server (Cloud Run):** catat revisi last-good saat deploy
  (`gcloud run revisions list --service token-server --region <REGION>`); rollback:
  `gcloud run services update-traffic token-server --region <REGION> --to-revisions <GOOD>=100`
  (graceful). ⚠️ **Worker = deploy terpisah**, TIDAK ikut rollback — restart/redeploy ke
  image yang cocok dan verifikasi ulang paritas `LIVEKIT_AGENT_NAME`.
- **Worker (GCE VM):** `sudo systemctl restart koperasi-worker` (restart, jangan kill
  mid-sesi — ada window drain). Image buruk: pull tag pinned + restart.
- **Frontend:** swap symlink ke rilis sebelumnya + `nginx -t && systemctl reload nginx`
  (jangan rebuild — rebuild mem-bake ulang CSP). Lihat `frontend-vps.md` §3.
- **Secret:** rotasi buruk → tambah versi secret sebelumnya; instance harus cycle.

## Migrasi DB (Supabase)
- Expand-contract, backward-compatible, **roll-forward (jangan down-migrate); jangan
  edit migrasi yang sudah diterapkan**. Jalur kanonik: merge `develop` → CI `db-deploy`.
- ⚠️ `CREATE INDEX CONCURRENTLY` / `VALIDATE CONSTRAINT` **tak bisa dalam transaksi** —
  taruh masing-masing di file migrasi sendiri; CONCURRENTLY gagal → index INVALID yang
  harus di-drop + buat ulang (forward). Batasi lock: `SET lock_timeout`/`statement_timeout`;
  backfill batch sebagai langkah terpisah; jadwalkan saat `/admin/*` sepi.
- Divergensi riwayat: `supabase migration repair`.

## Backup / restore (DUA jalur berbeda)
- **(a) Supabase managed / PITR = in-place & DESTRUKTIF** (dashboard; koordinasi downtime;
  tier Free tak punya backup). Bukan restore ke target terpisah.
- **(b) Portable** = satu-satunya jalur "restore ke target terpisah untuk verifikasi":
  `pg_dump -Fc` (koneksi session/direct, **bukan** txn pooler :6543; host direct IPv6-only
  tanpa add-on) → `pg_restore --no-owner --no-privileges -j4` ke target BARU (jangan over
  prod). ⚠️ `pg_dump` **tak membawa role cluster-global `metrics_reader`** → setelah restore,
  jalankan ulang migrasi + set ulang password `metrics_reader`. Tentukan siapa yang
  mengotorisasi restore prod.

## Mode kegagalan (sitasi tepat)
- `/token` 500 = `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER`/kredensial LiveKit belum di-set.
- `/token` 503 = masalah DB/bind; `/admin/*` 503 = pool down atau jebakan pooler-username.
- 401 vs 403 = auth (HTTPBearer 401 sebelum role 403); guest = `is_anonymous`.
- **metrics_reader:** username pooler wajib `metrics_reader.<project-ref>` (`api/metrics_db.py`,
  `.env.example`); re-apply `admin_metrics.sql` → NULL password → 503 sampai di-set ulang.
- `$3::uuid` cast di definer call (`apps/backend/CLAUDE.md`) — bind salah → 503 senyap.
- RPC hanya setelah agent join ~12–19 dtk (`CLAUDE.md`); API worker = `AgentServer` (bukan
  `WorkerOptions`); referensi `asyncio.create_task` wajib disimpan; drift hook/hosted Supabase.
- Worker warm: VM `Restart=always` (plafon sesi per worker → lihat `gcp-backend.md` §6).

## On-call — cek pertama
1. Alert nyata? (bukan flapping/duplikat) 2. Dampak? (user-facing sekarang?)
3. **Deploy/migrasi terbaru?** (yield tertinggi → kandidat rollback)
4. Health endpoint + log + dashboard. 5. **Halaman status provider** (LiveKit, Azure,
   Supabase, GCP) — kegagalan total provider tanpa perubahan kode sering = **cost
   cap/quota tripped**, bukan bug.

---

## Status & catatan handover
- Tiket: SIM-25/26/27/28/30 (M5), SIM-33 (M6 — Documentation & Handover).
- ⚠️ `docs/` di-gitignore repo ini → file set ini di-commit dengan `git add -f`
  (pola sama seperti `docs/qa/`).
- Versi `livekit-agents` **di-pin 1.6.5** di `uv.lock` (bukan 1.8.x) — API `AgentServer`,
  subcommand `start`/`download-files`, dan health server `:8081` semuanya terverifikasi
  di 1.6.5. Host docs GCP = `docs.cloud.google.com`; Vite 7 docs = `v7.vite.dev`; semua
  harga = tautan live.
- ✅ Container backend (SIM-26) sudah di-build & dijalankan (lihat `backend-containers.md`).
