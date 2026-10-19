# Konfigurasi Produksi — Referensi Tunggal (SIM-28)

> **Ini satu-satunya sumber otoritatif** untuk semua konfigurasi produksi: matriks
> env, origin (CORS + CSP), DNS, secret, dan prasyarat Supabase. Dokumen lain
> (`frontend-vps.md`, `gcp-backend.md`) menautkan ke sini — jangan menyalin ulang
> nilai, agar tidak drift.
>
> **Sumber kebenaran env tetap file `.env.example`** di tiap app (`apps/web`,
> `apps/admin`, `apps/backend`). Tabel di sini mendeskripsikan nilai produksi;
> `.env.example` mendefinisikan daftar var.

Ganti `<domain>` dan semua `<PLACEHOLDER>` dengan nilai asli Anda. **Jangan commit
nilai rahasia yang terisi.**

## 1. Topologi origin (triplet domain, dua mekanisme)

Ada **satu triplet domain** produksi (`app`, `admin`, `api`), dipartisi ke dua
mekanisme yang **saling melengkapi — bukan daftar yang sama**:

| Peran | Origin | Dipakai di |
|---|---|---|
| Frontend game (SPA) | `https://app.<domain>` | VPS nginx (`apps/web`) |
| Frontend admin (SPA) | `https://admin.<domain>` | VPS nginx (`apps/admin`) |
| Backend token server | `https://api.<domain>` | GCP (Cloud Run + LB) |

- **Backend `CORS_ALLOW_ORIGINS`** = **pemanggil** yang diizinkan:
  `https://app.<domain>,https://admin.<domain>` (bukan `api`).
- **CSP `connect-src` FE** (di-bake saat build) = **tujuan** yang boleh dihubungi:
  `https://api.<domain>` + origin Supabase + `wss:` LiveKit (bukan `app`/`admin`).

> ⚠️ Peran keduanya **berbeda**: CORS mendaftar pemanggil, CSP mendaftar tujuan.
> JANGAN memasukkan `api` ke `CORS_ALLOW_ORIGINS` atau `app`/`admin` ke `connect-src`.
> Keduanya tetap bisa drift terpisah — ubah triplet → cek kedua mekanisme.
> Deklarasikan di sini; `frontend-vps.md` (CSP) & `gcp-backend.md` (env CORS) menunjuk ke sini.

## 2. DNS (siapkan SEBELUM certbot & domain mapping)

| Record | Tipe | Target |
|---|---|---|
| `app.<domain>` | A / AAAA | IP publik VPS |
| `admin.<domain>` | A / AAAA | IP publik VPS |
| `api.<domain>` | A / CNAME | IP Load Balancer GCP (atau target Cloud Run domain-mapping) |

> certbot HTTP-01 (VPS) **dan** TLS terkelola GCP butuh nama ini sudah resolve.
> Verifikasi: `dig +short app.<domain>` dsb. mengembalikan target yang benar.

## 3. Matriks environment

Semua var `VITE_*` **build-time, PUBLIC, di-inline ke bundle** (bukan rahasia; ubah
→ wajib rebuild). Var backend di-set sebagai env host / Secret Manager (lihat §5).

### 3a. `apps/web` (game SPA — build-time)

| Var | Nilai produksi | Catatan |
|---|---|---|
| `VITE_TRANSPORT` | `livekit` | `mock` = offline, bukan untuk prod |
| `VITE_TOKEN_ENDPOINT` | `https://api.<domain>` | di-bake ke CSP `connect-src` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | di-bake ke CSP |
| `VITE_SUPABASE_ANON_KEY` | `<anon-key>` | anon/publishable saja — **bukan** service_role |
| `VITE_TURNSTILE_SITE_KEY` | `<turnstile-site-key>` | site key (publik); opsional tapi lihat §4 abuse |

### 3b. `apps/admin` (admin SPA — build-time)

| Var | Nilai produksi | Catatan |
|---|---|---|
| `VITE_ADMIN_API_ENDPOINT` | `https://api.<domain>` | ⚠️ admin pakai var ini, **bukan** `VITE_TOKEN_ENDPOINT` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | di-bake ke CSP |
| `VITE_SUPABASE_ANON_KEY` | `<anon-key>` | anon saja |
| `VITE_TURNSTILE_SITE_KEY` | `<turnstile-site-key>` | opsional |

### 3c. Token server (`apps/backend` — proses `api/server.py`)

| Var | Nilai produksi | Catatan |
|---|---|---|
| `LIVEKIT_URL` | `wss://<subdomain>.livekit.cloud` | |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `<key>` / `<secret>` | secret → Secret Manager |
| `LIVEKIT_AGENT_NAME` | `koperasi-agent` | ⚠️ **harus identik byte-per-byte dengan worker** (lihat §3d) |
| `SUPABASE_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` | ⚠️ kosong → **setiap `/token` 500** |
| `SUPABASE_JWT_ISSUER` | `https://<ref>.supabase.co/auth/v1` | ⚠️ kosong → **setiap `/token` 500** juga |
| `SUPABASE_JWT_AUD` | `authenticated` | default |
| `CORS_ALLOW_ORIGINS` | `https://app.<domain>,https://admin.<domain>` | lihat §6; blank → fallback localhost diam-diam |
| `TOKEN_RATE_CAPACITY` / `TOKEN_RATE_WINDOW_SEC` | `10` / `60` | per-`user_id`; lihat §4 |
| `METRICS_DB_URL` | DSN session-pooler (lihat §7) | hanya `/admin/*`; fail-soft 503 |
| `METRICS_DB_SSL` | `verify-full` | lihat §7 |

### 3d. Voice worker (`apps/backend` — proses `voice_worker/voice_agent.py`)

| Var | Nilai produksi | Catatan |
|---|---|---|
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | sama dgn token server | |
| `LIVEKIT_AGENT_NAME` | `koperasi-agent` | ⚠️ **identik dengan token server** — mismatch = token 200 tapi worker tak pernah join (hang senyap) |
| `AZURE_OPENAI_ENDPOINT` | `https://<resource>.openai.azure.com/` | |
| `AZURE_OPENAI_API_KEY` | `<key>` | secret |
| `AZURE_OPENAI_API_VERSION` | `2024-10-01-preview` | |
| `AZURE_OPENAI_DEPLOYMENT_DIALOGUE` | `gpt-5-mini` | nama **deployment** Azure, bukan nama model |
| `AZURE_OPENAI_DEPLOYMENT_AUDITOR` | `gpt-5.4` | |
| `AZURE_SPEECH_KEY` | `<key>` | secret |
| `AZURE_SPEECH_REGION` | `eastus2` | |

> **Batas koneksi DB (penting saat scale):** pool `METRICS_DB_URL` memakai
> `max_size=5` per proses dan session-pooler memin backend per koneksi. Jaga
> `instance_count × 5 ≤ CONNECTION LIMIT role metrics_reader (15)`. Token server
> **di-pin ke 1 instance** (lihat `gcp-backend.md`) → 5 koneksi (aman).

## 4. Anti-abuse: anonymous sign-in = risiko biaya (WAJIB baca)

Rate limiter `/token` membucket **per `user_id`**. Setiap anonymous sign-in
menghasilkan `sub` baru → bucket baru. Dengan anon sign-in ON **tanpa CAPTCHA**,
siapa pun bisa mint JWT guest tak terbatas → `/token` tak terbatas → dispatch agent
LiveKit/Azure berbayar tak terbatas. **Ini jalur financial-DoS langsung.**

Mitigasi (ketiganya):
- [ ] Set **secret server-side Turnstile** di Supabase (Auth → CAPTCHA) — site key
      saja (`VITE_TURNSTILE_SITE_KEY`) tidak cukup; verifikasi butuh secret.
- [ ] Pertahankan rate limit anonymous sign-in bawaan Supabase.
- [ ] **Cloud Run `--max-instances=1`** sebagai backstop biaya keras (lihat
      `gcp-backend.md`) — ini satu-satunya batas atas dispatch saat anon flood.

## 5. Kebijakan secret

| Publik (boleh di bundle/FE) | Rahasia (JANGAN di repo/CI/FE) |
|---|---|
| Semua `VITE_*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, Turnstile **site** key | `LIVEKIT_API_SECRET`, Azure keys, **Turnstile secret**, `METRICS_DB_URL`, Supabase `service_role` |

- Simpan yang rahasia di **GCP Secret Manager**; referensikan dari Cloud Run
  (`--set-secrets`). Default **pin versi `:N`** (rotasi = versi baru + restart
  instance); `:latest` hanya untuk rotasi zero-touch dan tetap butuh instance cycle.
- Service account per-service (bukan default compute SA), grant
  `roles/secretmanager.secretAccessor` **di resource secret**, bukan project-wide.
- `service_role` Supabase: **tidak pernah** menyentuh repo, CI, atau FE.

## 6. CORS

- `CORS_ALLOW_ORIGINS=https://app.<domain>,https://admin.<domain>` — scheme+host
  persis, **tanpa trailing slash, jangan `*`**. Legacy singular `CORS_ALLOW_ORIGIN`
  biarkan kosong di prod.
- `allow_credentials=False` benar: FE pakai header `Authorization: Bearer`, bukan
  cookie. CORS **bukan** gerbang auth — JWT Supabase (ES256 + klaim `is_admin`) lah.
- ⚠️ `CORS_ALLOW_ORIGINS` blank/whitespace → server **fallback diam-diam ke default
  dev localhost** (`:5173/:5174`). `curl` tanpa `Origin` & `/health` tetap hijau,
  tapi preflight browser asli dari `app.<domain>` diblok. Verifikasi dengan preflight
  langsung (lihat Go/No-Go di `README.md`).

## 7. `METRICS_DB_URL` (hanya `/admin/*`) — jebakan pooler

- Format hosted: DSN **session pooler**, username **`metrics_reader.<project-ref>`**
  (bukan `metrics_reader` polos → `FATAL: Tenant or user not found`), port `5432`,
  host dari dialog Connect Supabase:
  ```
  postgresql://metrics_reader.<project-ref>:<url-safe-secret>@aws-<idx>-<region>.pooler.supabase.com:5432/postgres
  ```
- `METRICS_DB_SSL=verify-full` (pakai CA sistem — cukup untuk host pooler Supabase).
- Password role di-set manual out-of-band **setelah** `db push` pertama (lihat
  `gcp-backend.md` §6, bootstrap `metrics_reader`).

## 8. Prasyarat proyek Supabase (langkah dashboard, bukan file repo)

- [ ] **Daftarkan `public.custom_access_token_hook`** di Authentication → Hooks
      (men-stamp klaim `is_admin`). ⚠️ GoTrue membaca config hook saat `supabase
      start`, bukan `db reset`. Verifikasi dengan men-decode JWT admin segar dan
      cek klaim `is_admin`.
- [ ] **Aktifkan anonymous sign-ins** di Authentication → Providers (guest play) —
      **hanya bersama** mitigasi abuse di §4.
- [ ] **Set secret Turnstile** (Auth → CAPTCHA) — lihat §4.
- [ ] Set password `metrics_reader`; seed baris `public.admins`.
- [ ] Salin JWKS URL / issuer / anon key ke matriks §3.

## Referensi
- `apps/backend/.env.example`, `apps/web/.env.example`, `apps/admin/.env.example`
- `apps/db/RUNBOOK.md` §10 (setup `metrics_reader`)
- `gcp-backend.md`, `frontend-vps.md`, `README.md` (Go/No-Go)
