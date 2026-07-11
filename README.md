# Simulasi Koperasi — `simulasi-koperasi-jjjlabs`

Game edukasi RPG tilemap 2D yang mengenalkan tata kelola dan pengambilan
keputusan koperasi di Indonesia. Pemain berjalan di lingkungan koperasi,
berinteraksi dengan NPC, menyelidiki situasi, lalu mengambil keputusan yang
dievaluasi.

Skenario unggulan: **Rapat Anggota Tahunan (RAT)**.

> Monorepo. Aplikasi utama ada di `apps/web`; pipeline suara & AI ada di `apps/backend`.

## Struktur Monorepo

```
simulasi-koperasi-jjjlabs/
├── apps/
│   ├── web/            # Frontend game utama (Vite + React + TS + Phaser 3 + Zustand + Tailwind v4)
│   ├── web-sementara/  # FE validasi pipeline voice (React + Vite + @livekit/components-react)
│   ├── backend/        # FastAPI (mint token) + voice worker (livekit-agents) + AI Auditor
│   ├── backent-prd.md  # PRD backend & AI pipeline
│   └── scenarios.md    # Definisi skenario
├── docs/               # Brainstorm & rencana implementasi
├── pnpm-workspace.yaml
└── package.json        # root workspace
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

Mode default **`mock`** berjalan penuh tanpa backend (percakapan terskrip, offline)
— cukup `pnpm install && pnpm dev`, langsung bisa dimainkan. Untuk pipeline suara
nyata, salin `apps/web/.env.example` → `.env.local`, set `VITE_TRANSPORT=livekit`
+ `VITE_TOKEN_ENDPOINT`, lalu jalankan backend (lihat `apps/backend/README.md`).

## Arsitektur

Tiga lapis utama:

1. **Dunia game (Phaser 3)** — tilemap 2D, pergerakan pemain, NPC, dan deteksi
   kedekatan (mendekati stasiun/NPC lalu tekan `E`) di `apps/web/src/game`.
2. **Antarmuka (React + Zustand)** — overlay UI di atas kanvas (menu, dialog,
   panel skenario, hasil). Phaser dan React tidak saling impor; keduanya
   berkomunikasi lewat satu jembatan Zustand (`stores/game.store.ts`,
   `stores/session.store.ts`).
3. **Sesi suara (transport seam)** — inti percakapan NPC berjalan di balik satu
   antarmuka `SessionTransport` (`session/transport/contract.ts`) dengan dua
   implementasi: **mock** (default, offline, terskrip) dan **livekit** (backend
   nyata: STT/TTS + LLM + AI Auditor). Dipilih lewat `VITE_TRANSPORT`. UI ditulis
   hanya terhadap kontrak — tak pernah mengimpor transport konkret.

**Skenario** adalah data: profil di `scenarios/scenario.config.ts` (briefing, NPC,
dokumen bukti) + skrip percakapan mock di `session/transport/mock/scripts/`.
Menambah skenario = menambah data, bukan menyentuh mesin. Evaluasi akhir
(klasifikasi state + skor + narasi) dihasilkan AI Auditor di backend saat mode
livekit; mock memakai ending terskrip dengan kunci state yang sama
(`components/session/resultLabels.ts`).

Backend (`apps/backend`) memisahkan `api/` (FastAPI, mint token LiveKit) dari
`voice_worker/` (livekit-agents: persona NPC, observer drift, Auditor). Kontrak
FE↔BE terinci di `apps/backend/CONTRACT.md`.

## Library & Teknologi

Frontend (`apps/web`):

- **Phaser 3** (`^3.90`) — engine game 2D: tilemap, sprite, arcade physics.
- **React 19** + **react-dom** — UI/chrome & overlay di atas kanvas game.
- **Zustand 5** — state bridge tunggal antara React ↔ Phaser.
- **Vite 7** — bundler & dev server.
- **Tailwind CSS v4** (`@tailwindcss/vite`) — styling UI.
- **livekit-client** (`^2.20`) — transport realtime (voice/data) saat mode `livekit`.
- **TypeScript 5.6** (strict) + **ESLint 9** / **typescript-eslint** — kualitas kode.

Backend (`apps/backend`, opsional untuk mode `livekit`):

- **Python + FastAPI** — server token (`api/server.py`), dikelola dengan **uv**.
- **livekit-agents** — voice worker (persona NPC, observer drift, AI Auditor).
- **Azure Speech** (STT/TTS) + **Azure OpenAI** (LLM dialog & Auditor).

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

Dunia koperasi bisa dijelajahi (Main Menu → peta interior), dengan sesi
percakapan bernilai skor pada mode `mock`. Skenario yang tersedia:

- **Tutorial — Koperasi Konsumen** (single-NPC, alur dasar tanpa skor).
- **Kredit Macet** (single-NPC, investigasi + penyelesaian sesuai prosedur).
- **Keanggotaan Fiktif** (single-NPC, audit data + diplomasi).
- **Rapat Anggota Tahunan (RAT)** (multi-NPC: Pak Darma & Ibu Sri, 3 fase +
  ketok palu, jalur TUNTAS/BUBAR).

Lihat `apps/web/README.md` untuk detail arsitektur frontend.
