# `web-sementara` — FE Validasi

Harness untuk memvalidasi pipeline Koperasi Simulator (PRD `apps/backent-prd.md` §4).
Terpisah dari `apps/web` (game tilemap) dan **bisa dijalankan tanpa backend
Python maupun kredensial LiveKit**.

Skenario yang sudah divalidasi: **Tutorial (Koperasi Konsumen)**, **Kredit
Macet**, **Keanggotaan Fiktif**, dan **Rapat Anggota Tahunan (RAT)**.

App boot ke **halaman awal (hub pemilihan skenario)**; pilih kartu → masuk sesi;
tombol **← Menu** kembali ke hub.

## Jalankan

```bash
pnpm install
pnpm --filter web-sementara dev
```

Tanpa file `.env`, app otomatis memakai transport **mock**. Tidak ada yang perlu
disiapkan.

## Arsitektur: satu transport seam

Seluruh UI ditulis terhadap satu interface, `SessionTransport`
(`src/transport/contract.provisional.ts`). Implementasinya ditukar lewat env:

| `VITE_TRANSPORT` | Implementasi | Status |
|---|---|---|
| `mock` (default) | `MockTransport` — skrip + timer, tanpa jaringan | ✅ jalan |
| `livekit` | `LiveKitTransport` — token REST + event/RPC LiveKit nyata | ✅ jalan (butuh backend) |

Aliran datanya satu arah:

```
Transport → sessionController → session.store → React
                    ↑                              │
                    └──────── aksi user ───────────┘
```

Komponen di `src/components/**` dan `src/views/**` **dilarang** (oleh ESLint)
mengimpor implementasi transport konkret. Itu yang menjaga agar menukar mock
dengan LiveKit tidak menyentuh satu pun file UI.

## Yang disimulasikan mock

- Sapaan NPC streaming karakter demi karakter (melatih jalur render
  *partial → final* yang nanti dipakai transcription LiveKit).
- Giliran NPC maju **satu langkah tiap kali pemain mengirim teks**. Isi teksnya
  diabaikan — tidak ada NLU. Deterministik, memang disengaja.
- Mic adalah no-op; jalur yang benar-benar diuji adalah teks (PRD Prinsip 4:
  teks sebagai fallback).
- **Drift (PRD §6 Lapisan 2)** disimulasikan dengan pencocokan keyword — bukan
  NLU. Kata represif/mengancam menaikkan skor tegangan, kata empatik
  menurunkannya; butuh beberapa giliran konsisten untuk naik level, dan level
  **bisa turun** kalau pemain berbalik baik.
  - **Level 1** → tombol Keputusan Akhir ditonjolkan; pemain didorong
    mengakhiri, tapi tetap boleh lanjut.
  - **Level 2** → NPC menutup diri, sesi **force-quit otomatis**.
  - Tombol **Debug drift** (L0/L1/L2, mock saja) untuk memaksa level saat demo.
  - Tutorial tidak menjalankan observer, jadi level-nya inert di 0 (PRD §7.1).
- **Hasil AI Auditor** disimulasikan terskrip. Ending **good/bad** dipilih dari
  jalur pemicu + level akhir: force-quit atau mengakhiri saat tegang → bad
  (berskor + berklasifikasi); mengakhiri saat tenang → good. Tutorial hanya
  punya pesan selamat, tanpa skor/taksonomi (PRD §7.1).
- **"Periksa Dokumen"** (Skenario 3 & RAT) adalah modal data statis di FE —
  tanpa backend/AI, sesuai PRD §7.3/§7.4.
- **RAT (Skenario 4)** menambah dua hal di atas fondasi yang sama:
  - **Dua NPC** (Pak Darma & Ibu Sri). Responder dipilih dengan menyebut nama
    di teks; kalau tidak, memakai default fase (Fase 2 → Pak Darma).
  - **State machine fase** via tombol aksi agenda: Fase 1 (Buka Rapat) →
    **Baca LPJ** → Fase 2 (interupsi Pak Darma muncul otomatis) →
    **Ambil Keputusan** → Fase 3 (Periksa Tata Tertib). Drift RAT mengarah ke
    **BUBAR**; Level 2 = rapat bubar (force-quit). `onPhase`/`advancePhase`
    ditambahkan ke `SessionTransport` sebagai **opsional** — PRD §9 memang
    mencantumkan transisi fase sebagai event kontrak masa depan.
    - Mock memilih responder via penyebutan nama → default fase. Backend nyata
      juga **menyeimbangkan giliran** antar-persona (pemimpin fase menjawab lebih
      dulu, lalu digilir) — lihat `apps/backend/CLAUDE.md`.

## Bantuan pemain (UI)

Fitur ini aktif di kedua transport (mock & livekit):

- **Briefing sesi** (`SessionBriefing`) — misi + langkah "yang perlu kamu lakukan"
  per skenario, dari `scenarios/catalog.ts` (`mission`/`steps`).
- **💡 Petunjuk** (`HintButton`/`HintPanel`) — minta saran mentor kontekstual.
  `livekit` → RPC `petunjuk` (backend `gpt-5-mini`); `mock` → petunjuk terskrip
  (`ScenarioScript.hints`). Kegagalan tidak menjatuhkan sesi.
- **Ringkasan LPJ** (`LpjPanel`, RAT fase ≥ 2) — menampilkan isi LPJ dari
  `scenarios/lpj.ts` agar pemain membaca sebelum mengambil keputusan.

## Batasan yang perlu diketahui

- Naskah dialog di `src/transport/mock/scripts/*.script.ts` adalah
  **placeholder**. Naskah asli ada di "dokumen skenario" yang belum ada di repo.
  Ambang drift & daftar keyword juga tebakan awal — perlu di-tune saat playtest.
- `contract.provisional.ts` adalah kontrak lokal FE; sumber kebenaran wire FE↔BE
  ada di `apps/backend/CONTRACT.md`. Jaga keduanya sinkron saat mengubah wire.
- `LiveKitTransport` sudah terisi penuh dan `livekit-client` sudah terpasang;
  jalankan dengan `VITE_TRANSPORT=livekit` + backend aktif.
