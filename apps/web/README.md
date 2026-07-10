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

## Dunia Phaser — Hub World

Pemilihan skenario berupa **hub spasial** (bukan menu). Alur:
Main Menu → **Desa** (klik gedung koperasi) → **Interior Koperasi** (klik ruangan)
→ overlay React → Ruang Meeting mengarah ke skenario RAT (stub).

- `src/game/` — kode Phaser (tak pernah impor React): `config.ts`, `createGame.ts`,
  `dimensions.ts`, `palette.ts`, `textStyles.ts`, `scenes/` (Boot/Village/
  KoperasiInterior), `interaction/makeInteractable.ts` (seam klik → nanti
  proximity+E).
- `src/world/rooms.config.ts` — data ruangan (netral; dipakai store, React, Phaser);
  `position` sekaligus calon collider.
- `src/components/game/GameCanvas.tsx` — jembatan React↔Phaser, StrictMode-safe.
  Hanya mengimpor `createGame` (bukan `phaser`) agar ESLint boundary tetap patuh.
- `src/components/hub/` — overlay & HUD React di atas canvas.
- Interaksi masih **klik saja**; movement karakter menyusul (ganti di
  `makeInteractable` saja).

Aset dunia = primitif Phaser (rect/teks) yang digambar runtime — **tanpa file
gambar**. Ganti dengan tileset/pixel-art nanti tanpa mengubah logika.

## Dunia Tilemap + Gerak (Desa)

Desa kini berupa **tilemap pixel-art asli** dengan **karakter yang bisa berjalan**:

- Aset **Ninja Adventure (CC0)** di `public/assets/ninja/` (lihat `CREDITS.txt`):
  `tileset_floor.png` (rumput/air/jalan), `tileset_village_abandoned.png`
  (bangunan/pohon), `samurai_green.png` (karakter 16×16, animasi jalan 4 arah).
- Peta = **Tiled JSON** (`village.json`, dapat diedit di editor Tiled): layer
  Ground / Collision / Objects (spawn + zona pintu).
- `src/game/scenes/PreloadScene.ts` memuat aset (progress bar);
  `VillageScene.ts` merender tilemap, menempatkan bangunan/pohon (stamp dari
  tileset) + collision, spawn `Player` (`entities/Player.ts`), dan kamera follow
  (zoom 3, chunky). HUD desa di `VillageHudScene.ts` (scene terpisah agar tidak
  ikut ter-zoom kamera).
- Kontrol: **WASD / panah** untuk bergerak; dekati pintu koperasi lalu tekan
  **E** (atau klik pintu) untuk masuk ke interior.

Ganti placeholder → aset final: cukup ganti file PNG / edit `village.json`; logika
tak berubah.

## Keterbatasan (iterasi tilemap)

- Interior koperasi masih berbasis klik (belum ada karakter berjalan di dalam).
- Gudang & Marketplace berstatus "Segera Hadir".
- Skenario RAT masih stub; mekaniknya menyusul.
- Teks di canvas memakai font fallback monospace bila web font belum termuat.
- Bundel menyertakan Phaser (~397 KB gz); pemisahan chunk ditunda.
