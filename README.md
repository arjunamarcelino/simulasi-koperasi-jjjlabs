# Koperasi Simulator — `simulasi-koperasi-jjjlabs`

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

## Status

Iterasi-1 (fondasi): monorepo + boot ke **Main Menu**. Belum ada gameplay.
Lihat `apps/web/README.md` untuk detail arsitektur frontend.
