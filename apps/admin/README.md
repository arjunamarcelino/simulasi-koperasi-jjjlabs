# Simulasi Koperasi — Admin Dashboard

Konsol operator (React SPA, **tanpa Phaser/LiveKit**, terpisah dari game `apps/web`).
Read-mostly: menampilkan metrik & analitik, mengelola konten, dan merotasi kode misi
lewat endpoint `GET/POST/DELETE /admin/*` di backend. **Tidak** menyentuh tabel Supabase
langsung — Supabase dipakai **hanya untuk auth** (login email/password + JWT).

## Surface (apa yang dikelola)

- **Metrik/KPI** (SIM-15) — `GET /admin/metrics`
- **Analitik per-skenario + drill-down** (SIM-16) — `GET /admin/scenarios/{id}/analytics`
- **Leaderboard musiman** — lihat/capture/hapus (SIM-17) — `GET/POST/DELETE /admin/leaderboard…`
- **Manajemen kuis** (SIM-18) — `GET/POST/DELETE /admin/quiz…`
- **Manajemen mading** (SIM-18) — `GET/POST/DELETE /admin/mading…`
- **Kode unlock misi** (SIM-42) — rotasi `redeem_code` — `GET /admin/missions`, `POST /admin/missions/{code}`

Kontrak REST lengkap + status code: `../backend/CONTRACT.md`.

## Stack

- **React 19** (StrictMode) + **TypeScript 5.6** (sangat strict)
- **Vite 7** + `@vitejs/plugin-react`
- **Zustand 5** — store vanilla + binding `useStore`
- **@supabase/supabase-js** — **auth saja** (schema kosong; tak query PostgREST)
- **Tailwind CSS v4** (`@theme` di `src/styles/index.css`)
- **Vitest** (env node) + Testing Library; **ESLint 9** (flat config)

## Perintah

```bash
pnpm dev        # vite dev server
pnpm build      # tsc --noEmit && vite build (CSP meta di-inject saat build)
pnpm preview    # serve hasil build
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint .
pnpm test       # vitest run
```

Dari root repo, `pnpm typecheck|lint|test` sudah fan-out ke `web` + `admin`; tapi root
`dev`/`build` hanya mentarget `apps/web` — jalankan dev admin lewat script paket di atas.

## Variabel environment

Semua `VITE_*` **build-time & PUBLIC**. Salin `.env.example` → `.env.local`, isi.

| Var | Fungsi |
|---|---|
| `VITE_SUPABASE_URL` | URL project Supabase (project yang sama dgn game); kosong → UI "auth unavailable" |
| `VITE_SUPABASE_ANON_KEY` | anon/publishable key saja — **jangan pernah** kunci rahasia bypass-RLS di browser |
| `VITE_ADMIN_API_ENDPOINT` | **origin** backend FastAPI (default `http://localhost:8000`); semua `/admin/*` + `Bearer` dikirim hanya ke origin ini |
| `VITE_TURNSTILE_SITE_KEY` | site key Turnstile untuk CAPTCHA login (CAPTCHA project-global di Supabase); kosong → tanpa widget (oke lokal) |

`vite.config.ts` meng-inject CSP ketat ke HTML hasil build (bukan dev); `connect-src`
dipatok ke `'self'` + origin Supabase + origin admin-API (membatasi exfiltrasi refresh token).

## Auth & role-gating

Entry `index.html` → `src/main.tsx` → `src/app/App.tsx`. `App` memanggil `initAdminAuth()`
sekali dan render berdasarkan `gate.status` dari `src/stores/adminAuth.store.ts`:
`loading` → splash; `authUnavailable` (tanpa env Supabase) → pesan terminal;
`unauthenticated` → `LoginForm`; `authorized` → `AdminShell`; `notAuthorized` → layar 403;
`serviceUnavailable` → layar retry.

- **Login:** `supabase.auth.signInWithPassword` (+ Turnstile opsional). **Tanpa signup** —
  akun admin di-provision server-side (seed/dashboard), bukan dari browser.
- **Probe:** tiap event auth ber-sesi → `GET /admin/me`. Otorisasi diputuskan **oleh HTTP
  STATUS saja** (200/403/401), tak pernah oleh body.
- **Klaim `is_admin`:** di-stamp ke JWT oleh `custom_access_token_hook` GoTrue berdasarkan
  keanggotaan `public.admins` (fail-safe, default `false`). Backend (`api/auth.py`) mewajibkan
  `is_admin AND NOT is_anonymous`. Sumber otoritatif model role + hook:
  `../db/supabase/migrations/20261003120000_admins.sql`.

## Menjalankan lokal

Prasyarat: Node ≥22, pnpm ≥10 (`pnpm install` dari root). Lalu:
1. **Supabase** terjangkau (`VITE_SUPABASE_URL`/`_ANON_KEY`), dengan `custom_access_token_hook`
   aktif dan minimal satu baris `public.admins` untuk user Anda.
2. **Backend jalan** di `VITE_ADMIN_API_ENDPOINT` (lihat `../backend/README.md`) — tanpa ini
   dashboard tak fungsional setelah login. Endpoint metrik juga butuh `METRICS_DB_URL` di
   backend atau akan 503 (fail-soft).
3. Turnstile: biarkan `VITE_TURNSTILE_SITE_KEY` kosong lokal (CAPTCHA off).
4. `pnpm dev`.

> **Provisioning admin:** keanggotaan `public.admins` dikelola manual server-side (seed/dashboard)
> (tidak ada signup in-app). Prosedur seed persisnya: lihat `../db/RUNBOOK.md` + migrasi
> `admins` di atas, atau konfirmasi dengan maintainer DB — jangan asumsikan perintah tertentu.

## Struktur

```
src/
├── main.tsx            # mount <App/> (StrictMode)
├── app/App.tsx         # gate router (switch gate.status)
├── components/         # AdminShell, LoginForm, NotAuthorized, StatusScreen, Turnstile
│   └── dashboard/      # KpiCard, ScenarioTable, ScenarioAnalyticsPanel, DistributionBars,
│                       # LeaderboardPanel/Table, QuizContentPanel, MadingContentPanel, MissionContentPanel
├── stores/             # adminAuth.store (state machine gate) + per-fitur store + adminCrud (primitif)
├── lib/                # adminApi.ts (REST, outcome-union, 401-refresh-once, timeout), supabase.ts (schema kosong),
│                       # mapAuthError, formatMetrics, distribution, assertNever
├── config/env.ts       # pembaca ENV typed (tanpa validasi eager — app harus boot tanpa env)
└── styles/index.css    # Tailwind v4 @import + @theme palette + ramp chart
```

Dokumen terkait: root `../../ARCHITECTURE.md`, `../backend/CONTRACT.md`, `../db/RUNBOOK.md`.
