# Deploy Backend ke GCP (SIM-27)

Deploy token server (Cloud Run) + voice worker (GCE VM) ke GCP, wiring kredensial via
Secret Manager, dan migrasi DB Supabase. DB tetap **Supabase** (bukan Cloud SQL —
lihat §8). Prasyarat env/secret: [`production-config.md`](./production-config.md).

> **Urutan wajib (CSP-bake):** FE mem-bake `https://api.<domain>` saat build. Putuskan
> domain `api.<domain>` **di awal** dan deploy backend lebih dulu, agar FE di-build
> dengan URL stabil. Dengan domain kustom, redeploy backend tak pernah memaksa rebuild FE.

Placeholder: `<PROJECT>`, `<REGION>`, `<REPO>`, `<domain>`, `<project-ref>`, dll.

## 1. Prasyarat
- `gcloud` ter-auth (`gcloud auth login`, `gcloud config set project <PROJECT>`).
- Image backend sudah di-build (lihat [`backend-containers.md`](./backend-containers.md)).
- DNS `api.<domain>` disiapkan (lihat `production-config.md` §2).

## 2. Artifact Registry — push image

```bash
gcloud artifacts repositories create <REPO> \
  --repository-format=docker --location=<REGION>
gcloud auth configure-docker <REGION>-docker.pkg.dev

IMG=<REGION>-docker.pkg.dev/<PROJECT>/<REPO>
docker build --target api    -t $IMG/token-server:v1 apps/backend
docker build --target worker -t $IMG/voice-worker:v1 apps/backend
docker push $IMG/token-server:v1
docker push $IMG/voice-worker:v1
```

## 3. Secret Manager (kredensial rahasia)

Simpan yang rahasia (LiveKit secret, Azure keys). Default **pin versi `:N`**.

```bash
printf '%s' '<livekit-api-secret>' | gcloud secrets create livekit-api-secret --data-file=-
printf '%s' '<azure-openai-key>'   | gcloud secrets create azure-openai-key   --data-file=-
printf '%s' '<azure-speech-key>'   | gcloud secrets create azure-speech-key   --data-file=-

# SA per-service (JANGAN pakai default compute SA yang Editor-level)
gcloud iam service-accounts create token-server-sa
# grant secretAccessor DI RESOURCE secret (bukan project-wide):
for S in livekit-api-secret azure-openai-key azure-speech-key; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:token-server-sa@<PROJECT>.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

Rotasi: tambah versi baru + restart instance (redeploy / `gcloud run services update`).
`:latest` hanya untuk rotasi zero-touch dan tetap butuh instance cycle.

## 4. Token server → Cloud Run

```bash
gcloud run deploy token-server \
  --image=$IMG/token-server:v1 \
  --region=<REGION> \
  --port=8000 \                                   # ⚠️ container listen 8000 (bukan default 8080)
  --min-instances=1 --max-instances=1 \           # ⚠️ lihat catatan di bawah
  --concurrency=80 \
  --service-account=token-server-sa@<PROJECT>.iam.gserviceaccount.com \
  --allow-unauthenticated \                       # JWT-lah gerbang; ini mengekspos /health + preflight
  --set-env-vars="LIVEKIT_URL=wss://<sub>.livekit.cloud,LIVEKIT_API_KEY=<key>,LIVEKIT_AGENT_NAME=koperasi-agent,SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json,SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1,SUPABASE_JWT_AUD=authenticated,CORS_ALLOW_ORIGINS=https://app.<domain>\,https://admin.<domain>,METRICS_DB_SSL=verify-full" \
  --set-secrets="LIVEKIT_API_SECRET=livekit-api-secret:1,METRICS_DB_URL=metrics-db-url:1" \
  --startup-probe=httpGet.path=/health,httpGet.port=8000
```

> ⚠️ **`--set-env-vars` MENGGANTI semua** (pakai `--update-env-vars` untuk merge).
> Nilai berisi koma (seperti `CORS_ALLOW_ORIGINS`) harus di-escape `\,` atau pakai
> delimiter kustom `--set-env-vars "^##^KEY=a,b##..."`.

**Kenapa `--min/--max-instances=1`:** rate limiter `/token` **in-memory per-proses**
(`api/ratelimit.py`). N instance = N× batas (mitigasi abuse melemah justru saat beban
naik). Pin ke 1 instance juga membatasi fan-out koneksi DB (pool `max_size=5` × 1 =
5 ≤ CONNECTION LIMIT `metrics_reader` 15). Simulator handover trafik rendah → satu
instance warm dgn concurrency 80 cukup, dan `max-instances=1` jadi **backstop biaya
keras** terhadap anon-flood (lihat `production-config.md` §4).

## 5. `api.<domain>` → Load Balancer + serverless NEG

Domain-mapping Cloud Run masih Preview dengan celah regional. Jalur produksi yang
kokoh: **External Application Load Balancer + serverless NEG** (juga prasyarat jika
kelak difronting Cloud Armor untuk abuse).

```bash
gcloud compute network-endpoint-groups create token-neg \
  --region=<REGION> --network-endpoint-type=serverless --cloud-run-service=token-server
# lalu: backend-service + url-map + target-https-proxy + managed cert untuk api.<domain>
#       + forwarding-rule ke IP global. Arahkan DNS api.<domain> → IP itu.
```
Docs: https://docs.cloud.google.com/load-balancing/docs/https/setting-up-https-serverless
Alternatif cepat (verifikasi GA di region Anda dulu): `gcloud run domain-mappings create
--service token-server --domain api.<domain>`.

## 6. Voice worker → GCE VM + systemd (pilihan produksi)

Worker outbound-only (daftar ke LiveKit; tak ada inbound). LiveKit menyarankan drain
10+ menit untuk panggilan aktif. VM + systemd memberi kontrol penuh drain & lebih
murah untuk beban 24/7.

```bash
gcloud compute instances create voice-worker \
  --zone=<ZONE> --machine-type=e2-standard-4 \
  --image-family=debian-12 --image-project=debian-cloud \
  --service-account=worker-sa@<PROJECT>.iam.gserviceaccount.com --scopes=cloud-platform
# firewall: TANPA inbound selain SSH terhardening (utamakan IAP).
```

Jalankan container worker di VM via systemd unit (`/etc/systemd/system/koperasi-worker.service`):
```ini
[Service]
ExecStartPre=/usr/bin/docker pull <REGION>-docker.pkg.dev/<PROJECT>/<REPO>/voice-worker:v1
ExecStart=/usr/bin/docker run --rm --name koperasi-worker --env-file /etc/koperasi/worker.env <IMG>/voice-worker:v1
Restart=always
KillSignal=SIGTERM
TimeoutStopSec=660          # ⚠️ ≥ drain window LiveKit (10+ mnt) agar panggilan tak di-SIGKILL
[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now koperasi-worker`.

> **Kapasitas & SPOF:** satu VM = SPOF dengan plafon sesi-konkuren per worker. Dapat
> diterima untuk v1 — **catat** plafonnya dan tuas skala (MIG target size /
> `num_idle_processes`) agar pemilik berikut tak kaget saat pemanggil ke-N tak dapat agent.
>
> *Alternatif serverless: Cloud Run worker pools (GA 2026-04) — tidak dicakup di sini;
> grace terminasinya mungkin lebih pendek dari window drain. Worker Cloud Run, jika
> dipakai, **JANGAN** `--allow-unauthenticated` (outbound-only, invoker publik = murni
> attack surface).*

## 7. DB & migrasi (Supabase)

> **Jalur kanonik = merge ke `develop` → CI `.github/workflows/db-deploy.yml`** (ia juga
> seed + smoke). Manual `db push` = **break-glass** saja.

```bash
supabase login                          # atau export SUPABASE_ACCESS_TOKEN=...
supabase link --project-ref <project-ref>
supabase db push --dry-run              # review dulu
supabase db push --linked               # terapkan migrasi (timestamp order)
supabase migration list --linked        # LOCAL == REMOTE baris-per-baris
```
Break-glass manual push: pastikan (a) tak ada run CI berjalan, (b) migrasi sudah
di-commit, (c) jalankan seed + smoke manual sesudahnya. Divergensi riwayat →
`supabase migration repair`. **Jangan pernah edit migrasi yang sudah diterapkan** —
fix forward.

### Bootstrap `metrics_reader` (untuk `/admin/*`), berurutan
1. `supabase db push` membuat role (NULL password) via `20261009120000_admin_metrics.sql`.
2. Set password lewat koneksi **privileged tenant-qualified** (bukan role polos):
   ```bash
   psql "postgresql://postgres.<project-ref>:<db-password>@aws-<idx>-<region>.pooler.supabase.com:5432/postgres?sslmode=require" \
     -c "ALTER ROLE metrics_reader WITH PASSWORD '<url-safe-secret>';"
   ```
3. Set `METRICS_DB_URL` backend = DSN pooler username **`metrics_reader.<project-ref>`**
   + `METRICS_DB_SSL=verify-full` (lihat `production-config.md` §7).

> ⚠️ Re-apply `admin_metrics.sql` setelah teardown mereset role ke NULL password →
> `/admin/*` 503 sampai di-set ulang. `verify-full` memakai CA sistem terhadap host
> **pooler** (bukan host direct); jika rantai gagal, unduh CA Supabase.

## 8. Catatan: kenapa Supabase, bukan Cloud SQL
Sistem berjalan di Supabase (Postgres 15 + GoTrue). `/token` & `/health` tak menyentuh
DB; hanya `/admin/*`. Tak ada provisioning Cloud SQL. Jika kelak perlu Cloud SQL,
itu proyek baru (connector + `--add-cloudsql-instances`) — di luar lingkup handover.

## 9. Smoke check

```bash
API=https://api.<domain>
curl -fsS $API/health                                             # 200 {"status":"ok"} (liveness, config-blind)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/token \
  -H 'Content-Type: application/json' -d '{"scenario_id":"kredit-macet"}'   # 401 (BUKAN 500)
# 500 = JWKS/issuer/LiveKit belum di-set. Worker join: lihat log registrasi di VM.
gcloud compute ssh voice-worker --zone <ZONE> --command \
  'journalctl -u koperasi-worker -n 50 --no-pager | grep -iE "registered|agent"'
```

Go/No-Go penuh + E2E: lihat [`README.md`](./README.md).

## Referensi
- Cloud Run deploy/secrets: https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy · /run/docs/configuring/services/secrets
- Secret Manager best-practices: https://docs.cloud.google.com/secret-manager/docs/best-practices
- Supabase migrations: https://supabase.com/docs/guides/deployment/database-migrations
- `.github/workflows/db-deploy.yml`, `apps/db/RUNBOOK.md` §10
