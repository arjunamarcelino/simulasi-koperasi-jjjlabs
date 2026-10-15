# Simulasi Koperasi — Web (Frontend game)

Game SPA untuk **Simulasi Koperasi**: hub spasial (Phaser) + overlay React, dengan
sesi suara edukatif (Azure STT→LLM→TTS lewat backend, atau mock offline). Pemain
menjelajah desa, masuk koperasi, dan menjalankan skenario (headline: **RAT**).

## Stack

- **Vite 7** + **React 19** + **TypeScript 5** (strict)
- **Phaser 3.90** — dunia game (ter-instansiasi penuh: Boot/Preload/Village/KoperasiInterior)
- **Zustand 5** — jembatan tunggal React ↔ Phaser (`src/stores/game.store.ts`)
- **Tailwind CSS v4** (config-less, `@theme` + `@utility` di `src/styles/index.css`)
- **@supabase/supabase-js** — auth + persistensi (RLS, web-direct)
- **livekit-client** — transport suara `livekit`
- **@simkop/catalog** (`workspace:*`) — konten katalog bersama (sumber kebenaran tunggal)

## Perintah

Dari root repo (mendelegasi `pnpm --filter web`) atau di dalam `apps/web`:

```bash
pnpm dev           # vite dev server
pnpm build         # tsc --noEmit && vite build
pnpm preview       # serve hasil build
pnpm typecheck     # tsc --noEmit
pnpm typecheck:e2e # tsc -p e2e/tsconfig.json (typecheck spec Playwright)
pnpm lint          # eslint .
pnpm test          # vitest run (unit)
pnpm e2e           # node e2e/run-e2e.mjs — smoke jalur-kritis (butuh Docker)
pnpm e2e:play      # playwright test langsung
```

**E2E smoke** (`e2e/`, SIM-22) adalah cek keyakinan jalur-kritis: `pnpm e2e` menyalakan
Supabase lokal, menyajikan app di port khusus, men-drive skenario `kredit-macet` di
transport **mock**, lalu meng-assert baris `public.sessions` yang ter-skor.

## Transport seam — mock vs livekit

Satu titik pemilihan: `src/session/transport/createTransport.ts` membaca `ENV.transport`
(`VITE_TRANSPORT`) dan mengembalikan `MockTransport` atau `LiveKitTransport`. Default =
**mock** untuk nilai apa pun selain persis `"livekit"`. Import sengaja statis+sinkron
(menjaga `start()` sinkron, menghindari race lifecycle); `livekit-client` tetap ter-bundle.

- Kontrak seam: `src/session/transport/contract.ts`
- Mock (offline, skrip): `src/session/transport/mock/` (+ `mock/scripts/*.script.ts` per skenario)
- LiveKit (nyata): `src/session/transport/livekit/LiveKitTransport.ts` — ambil token dari `VITE_TOKEN_ENDPOINT`

Kontrak wire FE↔BE selengkapnya: `../backend/CONTRACT.md`.

## Variabel environment

Semua `VITE_*` **build-time & PUBLIC** (di-inline ke bundle) — jangan pernah menaruh
rahasia. Tanpa satu pun di-set, app tetap boot: **mock + mode degraded tanpa-auth**.
Salin `.env.example` → `.env.local`, lalu isi.

| Var | Fungsi |
|---|---|
| `VITE_TRANSPORT` | `mock` (default, offline deterministik) atau `livekit` |
| `VITE_TOKEN_ENDPOINT` | endpoint `POST /token` backend; hanya dipakai saat `livekit` (lokal: `http://localhost:8000`) |
| `VITE_SUPABASE_URL` | URL project Supabase (PUBLIC) |
| `VITE_SUPABASE_ANON_KEY` | anon/publishable key (RLS-bounded, PUBLIC — **bukan** service_role); unset → mode degraded |
| `VITE_TURNSTILE_SITE_KEY` | site key Cloudflare Turnstile (SIM-41); set → widget invisible pada anon sign-in; unset → tokenless |

## Arsitektur — React ↔ Phaser

**React dan Phaser tidak pernah saling impor.** Keduanya hanya bicara lewat store
Zustand `src/stores/game.store.ts`:
- React membaca via `useGameStore(selector)`.
- Kode Phaser membaca/menulis via API vanilla `gameStore.getState()` / `gameStore.subscribe()`.
- Store hanya menyimpan **data serializable** — jangan menaruh objek Phaser di store.

Navigasi view = `currentView` + `switch` di `src/app/App.tsx` (tanpa react-router).
Batas ini **ditegakkan ESLint**: file di `src/pages/**` dan `src/components/**` dilarang
mengimpor `phaser`. `src/components/game/GameCanvas.tsx` hanya mengimpor `createGame`
(bukan `phaser`) agar batas tetap patuh.

## Struktur

```
src/
├── app/            # App.tsx (switch(currentView) router) + e2eHarness
├── pages/          # MainMenu, Loading, Hub, Game, Evaluation
├── components/     # common/ (ErrorBoundary, GameButton, ModalShell, PixelPanel)
│                   # game/ (GameCanvas = jembatan), hub/ (board kuis/misi/mading/leaderboard/profil),
│                   # session/ (UI sesi suara: ActionRail, BigCharacter, DialogueBox)
├── game/           # kode Phaser (tak impor React): scenes/, entities/Player.ts, interaction/, config/palette/textStyles
├── session/        # seam transport: sessionController.ts, controller.ts, transport/
├── stores/         # game.store.ts (jembatan), auth.store.ts, session.store.ts, persist.ts
├── lib/            # supabase.ts, authedFetch.ts, captcha.ts, *Repo.ts (progress/sessions/mading/leaderboard), parseGuards
├── scenarios/      # scenario.config.ts (RAT = headline; keempat skenario AVAILABLE) + parity test
├── content/        # badges / koperasi-facts / missions / vouchers
├── config/env.ts   # pembaca ENV typed untuk semua VITE_* (tanpa validasi eager)
├── world/          # rooms.config.ts (data ruangan netral; dipakai store/React/Phaser)
├── types/          # scenario.ts
└── styles/index.css# Tailwind v4 @import + @theme palette + @utility
```

## Menjalankan lokal

`pnpm dev` (atau dari root) → app boot di transport **mock** (skrip, offline,
deterministik), mode degraded tanpa-auth — tanpa backend/Supabase/LiveKit. Untuk
menguji jalur nyata: `VITE_TRANSPORT=livekit` + `VITE_TOKEN_ENDPOINT` (backend jalan),
dan isi `VITE_SUPABASE_*` untuk auth/persistensi.

## Aset dunia

Desa = **tilemap pixel-art asli** (aset **Ninja Adventure, CC0** di
`public/assets/ninja/`, lihat `CREDITS.txt`); peta = Tiled JSON (`village.json`).
Kontrol: **WASD/panah** bergerak; dekati pintu koperasi lalu tekan **E** (atau klik).
Ganti placeholder → aset final cukup dengan mengganti PNG / mengedit `village.json`;
logika tak berubah.

## Keterbatasan diketahui

- Interior koperasi masih berbasis klik (belum ada karakter berjalan di dalam).
- Beberapa room berstatus "Segera Hadir" / stub.
- Teks canvas memakai fallback monospace bila web font belum termuat.
- Bundel menyertakan Phaser (~400 KB gz); pemisahan chunk ditunda.
