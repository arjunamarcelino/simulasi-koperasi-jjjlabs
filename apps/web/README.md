# Koperasi Simulator — Web (Frontend)

Frontend untuk **Koperasi Simulator**. Iterasi-1 (fondasi): aplikasi boot sampai
**Main Menu**. Belum ada gameplay Phaser.

## Stack

- **Vite 7** + **React 19** + **TypeScript 5** (strict)
- **Tailwind CSS v4** (config-less, `@theme` + `@utility` di `src/styles/index.css`)
- **Zustand 5** — jembatan tunggal React ↔ (nanti) Phaser
- **Phaser 3.90** — terpasang, belum di-instansiasi

## Perintah

Dari root repo (mendelegasi via `pnpm --filter web`), atau di dalam `apps/web`:

```bash
pnpm dev         # vite dev server
pnpm build       # tsc --noEmit && vite build
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
```

## Arsitektur — bagaimana React & Phaser berkomunikasi

Prinsip: **React dan Phaser tidak pernah saling impor.** Keduanya hanya bicara
lewat store Zustand (`src/stores/game.store.ts`).

- React membaca state via hook `useGameStore(selector)`.
- Kode non-React / Phaser (nanti) membaca & menulis via API vanilla:
  `gameStore.getState().setView(...)`, `gameStore.subscribe(...)`.
- Store hanya menyimpan **data serializable** — jangan pernah menaruh objek
  Phaser di store.

Navigasi view memakai `currentView` (enum) + `switch` di `src/app/App.tsx`
(tanpa react-router). Batas arsitektur ditegakkan ESLint: file di
`src/pages/**` dan `src/components/**` dilarang mengimpor `phaser`.

## Struktur

```
src/
├── app/App.tsx           # ErrorBoundary + switch(currentView) router
├── pages/                # MainMenuPage (penuh) + 3 placeholder
├── components/common/    # GameButton, PixelPanel, ErrorBoundary
├── game/                 # SEAM Phaser (kosong; tanpa impor React)
├── stores/game.store.ts  # store Zustand vanilla + useGameStore
├── scenarios/            # scenario.config.ts (RAT = headline)
├── types/                # scenario.ts
└── styles/index.css      # Tailwind v4 @import + @theme palette + @utility
```

## Mengganti placeholder aset

Ikon dan latar saat ini murni CSS/SVG lokal (`public/favicon.svg`,
utility `koperasi-bg` di `index.css`). Ganti dengan aset pixel-art asli tanpa
mengubah logika: cukup taruh aset di `public/` atau `src/assets/` dan rujuk dari
CSS/komponen.

## Menghubungkan backend nanti

Iterasi ini belum memakai service/API (tidak ada `VITE_` env var). Lapisan
service (`GameApiService` + mock/http + pemilihan via `VITE_USE_MOCK_API`)
ditambahkan pada iterasi berikutnya saat ada konsumennya (pemilihan skenario /
dialog). Rahasia LLM tidak boleh diekspos di frontend.

## Keterbatasan (iterasi-1)

- Belum ada dunia Phaser (peta, pemain, NPC, dialog).
- Skenario selain RAT berstatus "Segera Hadir".
- Halaman GAME & EVALUATION masih placeholder.
