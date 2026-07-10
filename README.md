# Simulasi Koperasi — `simulasi-koperasi-jjjlabs`

Game edukasi RPG tilemap 2D yang mengenalkan tata kelola dan pengambilan
keputusan koperasi di Indonesia. Pemain berjalan di lingkungan koperasi,
berinteraksi dengan NPC, menyelidiki situasi, lalu mengambil keputusan yang
dievaluasi.

Skenario unggulan: **Rapat Anggota Tahunan (RAT)**.

> Monorepo. Fokus pengembangan saat ini: **frontend/interface** di `apps/web`.

## Struktur Monorepo

```
simulasi-koperasi-jjjlabs/
├── apps/
│   └── web/          # Frontend (Vite + React + TS + Phaser 3 + Zustand + Tailwind v4)
├── packages/         # (kode bersama, menyusul)
├── pnpm-workspace.yaml
└── package.json      # root workspace
```

## Prasyarat

- Node.js **>= 22** (lihat `.nvmrc`)
- pnpm **>= 10**

## Perintah

```bash
pnpm install          # pasang semua dependency workspace
pnpm dev              # jalankan frontend (apps/web) dalam mode dev
pnpm build            # build produksi frontend
pnpm typecheck        # cek TypeScript (strict)
pnpm lint             # ESLint
```

Semua perintah root mendelegasikan ke `apps/web` via `pnpm --filter web`.

## Library & Teknologi

Frontend (`apps/web`):

- **Phaser 3** (`^3.90`) — engine game 2D: tilemap, sprite, arcade physics.
- **React 19** + **react-dom** — UI/chrome & overlay di atas kanvas game.
- **Zustand 5** — state bridge tunggal antara React ↔ Phaser.
- **Vite 7** — bundler & dev server.
- **Tailwind CSS v4** (`@tailwindcss/vite`) — styling UI.
- **TypeScript 5.6** (strict) + **ESLint 9** / **typescript-eslint** — kualitas kode.

Tooling dev:

- **Pillow** (Python) — dipakai `apps/web/tools/tile-inspect.py` untuk memilih tile dari tileset.

## Aset & Kredit

Aset seni dipakai dengan lisensi bebas. Detail per-berkas juga ada di
`apps/web/public/assets/ninja/CREDITS.txt`.

| Aset | Sumber | Lisensi |
|------|--------|---------|
| Tileset ground / desa / interior + sprite samurai | [Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack) — Pixel-boy (& AAA) | **CC0 1.0** (public domain) |
| Sprite pemain "villager" (Man Sprite 16x16) | [OpenGameArt](https://opengameart.org/content/man-sprite-16x16) — Ivan Voirol dkk | **CC0** |
| Furniture interior (meja, kursi, rak, mading) — *sedang diintegrasikan* | [Modern Interiors](https://limezu.itch.io/moderninteriors) — **LimeZu** | Free version: **non-komersial**, **wajib kredit LimeZu** (bukan CC0) |

> **Catatan lisensi LimeZu:** versi gratis hanya untuk penggunaan **non-komersial** dan
> **wajib mencantumkan kredit ke LimeZu**. Proyek ini non-komersial (hackathon/edukasi),
> jadi sesuai syarat. Untuk penggunaan komersial: beli versi berbayar LimeZu atau ganti
> dengan aset CC0 (mis. [ArMM1998 Zelda-like](https://opengameart.org/content/zelda-like-tilesets-and-sprites), CC0).

## Sumber Data

Statistik koperasi yang tampil pada **Papan Pengetahuan** (mading dekat pintu
interior koperasi) dikutip dari Dashboard SIMKOPDES. Pengutipan pada dashboard
diizinkan sepanjang menyertakan sumber:

> SIMKOPDES. (2026). *Dashboard SIMKOPDES*. Kementerian Koperasi Republik
> Indonesia. Diakses pada 11 Juli 2026, pukul 01.00 WIB, dari
> https://simkopdes.go.id/pers/dashboard

## Status

Iterasi-1 (fondasi): monorepo + boot ke **Main Menu**. Belum ada gameplay.
Lihat `apps/web/README.md` untuk detail arsitektur frontend.
