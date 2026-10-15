# @simkop/db — Koperasi Simulator data model

Skema Supabase/Postgres: migrations, seed (generated), seed dev, tes pgTAP, smoke, dan
skrip yang menjaga parity dengan paket katalog bersama `@simkop/catalog`.

Konsumen database:
- **`apps/web`** — web-direct via `supabase-js`, dibatasi **RLS** (jalur runtime utama).
- **`apps/backend` & `apps/admin`** — fungsi analitik/konten admin lewat role
  **`metrics_reader`** (skema `admin`, EXECUTE-only). *Backend bukan lagi sepenuhnya
  database-free* — ini satu-satunya jalur DB-nya.

> Dokumen lebih dalam: **[`DATA-MODEL.md`](./DATA-MODEL.md)** (ERD AS-IS/TARGET, 15 tabel
> + kolom, semua RPC, tabel gap, per-fitur SIM-14…42) dan **[`RUNBOOK.md`](./RUNBOOK.md)**
> (provisioning hosted, config auth dashboard, keep-alive, Go/No-Go, rollback, §10 setup
> `metrics_reader`).

## Layout

Konten katalog = paket `@simkop/catalog` (`packages/catalog`), diimpor oleh `apps/web`
**dan** generator seed di sini — sumber kebenaran tunggal.

```
seed-codes.json         # kode unlock reallife (SERVER-ONLY; masuk seed.sql, bukan bundle klien)
scripts/
  gen-seed.mjs          # @simkop/catalog + seed-codes.json → supabase/seed.sql (--check = parity guard)
  check-levels.mjs      # pin ambang level_from_xp() ke @simkop/catalog levels.json
  e2e-admin-hook.mjs    # e2e: custom access token hook (klaim is_admin)
  e2e-metrics.sh        # e2e: role metrics_reader nyata
supabase/
  config.toml           # port 54322, PG15, anon sign-ins ON, email provider ON, custom_access_token_hook ON
  migrations/           # 20 migrasi ter-timestamp (foundation → progress → gameplay → economy →
                        #   achievements → quiz → reconcile → record_session → admins → admin_metrics →
                        #   scenario_analytics → leaderboard_snapshots → quiz/mading content → session_export → mission_content)
  seed.sql              # GENERATED — jangan edit tangan
  seeds/                # dev-only (TIDAK ikut seed.sql): dev_admins.sql, dev_sessions.sql
  tests/                # 17 file pgTAP (schema-smoke, rls-isolation, rpc-behavior, quiz, record-session, admin/*)
  smoke/run.sh          # cek smoke pasca-deploy (jumlah tabel/seed, grant ditolak, JWKS ES256)
```

Tanpa `src/` — paket ini murni SQL + skrip `.mjs`/`.sh`. **Tidak ada `gen:types`**
(generasi tipe TS belum di-wire). Tidak ada `.env.example` di sini.

## Perintah

```bash
# Regenerasi seed setelah mengedit packages/catalog/data/*.json
pnpm --filter @simkop/db gen:seed

# Guard CI: gagal bila seed.sql basi vs @simkop/catalog
pnpm --filter @simkop/db check:parity

# Guard CI: gagal bila level_from_xp() drift dari @simkop/catalog levels.json
pnpm --filter @simkop/db check:levels

# Butuh Supabase CLI + Docker:
supabase start                     # nyalakan stack lokal (Postgres :54322)
pnpm --filter @simkop/db db:reset  # replay migrasi + jalankan seed.sql
pnpm --filter @simkop/db db:test   # jalankan pgTAP (supabase test db)
```

CI menjalankan reset + tes tiap push (`.github/workflows/db-tests.yml`), jadi Docker tak
wajib untuk mendaratkan perubahan — tapi perlu untuk menjalankan tes DB sendiri.

**Setup `metrics_reader` lokal** (agar `apps/backend` `/admin/*` jalan; detail di RUNBOOK §10):
setelah `supabase start`, set password role lalu arahkan `METRICS_DB_URL` backend ke sana
(`metrics_reader` port 54322). Kode reallife lokal ada di `seed-codes.json`.

## Entitas (sekilas; 15 tabel + role admin)

- **User-scoped:** `profiles`, `user_progress`, `sessions`, `mission_completion`,
  `voucher_redemption`, `user_badge`, `quiz_completion`.
- **Katalog/definisi:** `scenario_definition`, `mission_definition`, `voucher_definition`,
  `badge_definition`, `quiz_definition`.
- **Leaderboard musiman:** `leaderboard_seasons`, `leaderboard_entries`.
- **Konten:** `mading_block`. **Admin:** `public.admins` + skema `admin` (fungsi definer,
  tak pernah diekspos ke PostgREST).
- **View publik** (menyembunyikan kolom rahasia): `mission_catalog` (tanpa `redeem_code`),
  `quiz_catalog` (tanpa `correct_index`/`explanation`), `mading_catalog`.

## Invarian kunci

- **RLS adalah batas keamanan.** Semua tabel `public` mengaktifkan RLS; tabel user-scoped
  owner-only (`(select auth.uid()) = user_id`) dengan `WITH CHECK` pada write.
- **Kode gate reallife tidak di permukaan klien DB** (defense-in-depth): `mission_definition`
  di-revoke dari `anon`/`authenticated`; view publik menghilangkan `redeem_code`. Sejak SIM-9
  kode hidup **server-only** (`seed-codes.json`), tidak lagi di bundle klien. Catatan: ini
  gerbang *lunak*, bukan secret kriptografis.
- **Integritas server via RPC `SECURITY DEFINER`** (`search_path=''`, EXECUTE di-revoke dari
  public): mis. `claim_mission`, `redeem_voucher`, `record_session`, `submit_quiz`,
  `get_my_progress`, `sync_badges`, `reconcile_local_progress`, `leaderboard`. `add_rewards`
  = helper privat (tak client-callable). Daftar lengkap di `DATA-MODEL.md`.
- **Level diturunkan, tak disimpan** (`level_from_xp`). Klaim sekali-pakai idempoten via
  `UNIQUE(user_id, …)` + `ON CONFLICT DO NOTHING`.
