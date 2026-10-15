# Cara Menambah Skenario (FE + BE + CONTRACT)

> Panduan langkah-demi-langkah menambah satu skenario baru end-to-end. Filosofi
> proyek: **"skenario = data, bukan kode"** — hampir semua wiring sudah generik; Anda
> menambah *data* di beberapa lapisan dan menjaganya tetap sinkron. Jaring pengaman
> utama = **parity test + guard CI**: kalau ada yang lupa di-update, test gagal dan
> memberi tahu persis apa.

**Terakhir diverifikasi: 2026-10-16** · Template: keempat skenario yang ada
(`tutorial-koperasi-konsumen`, `kredit-macet`, `keanggotaan-fiktif`, `rapat-anggota-tahunan`).

---

## 0. Model mental

- **`scenario_id`** (kebab-case, mis. `kredit-macet`) adalah **kunci join** yang sama di
  SEMUA lapisan: katalog, seed DB, konfig FE, skrip mock, registry BE, `VALID_SCENARIOS`,
  CONTRACT. Set id harus **identik** antar lapisan — dipaksa oleh test (set-equality),
  bukan oleh import.
- **Satu sumber kebenaran katalog**: `packages/catalog/data/scenarios.json`. FE dan
  generator seed DB membaca dari sini.
- **Dua transport** menjalankan skenario yang sama:
  - **mock** (`apps/web`, offline, deterministik) — drift **berbasis keyword**.
  - **livekit** (`apps/backend`, voice nyata) — drift **dinilai LLM** (`gpt-5-mini`).
  Keduanya memakai ambang streak `level1`/`level2` yang sama (Level 2 → force-quit).
- **Skor & taksonomi di-render generik** (`scores: Record<string, number>`,
  `stateClassification: Record<string, string>`) — tak ada nama key yang di-hardcode di
  jalur render. TAPI FE butuh **label** untuk key baru (lihat Langkah 7).
- **Single-NPC vs multi-NPC (RAT):** panduan ini fokus **single-NPC**. Multi-NPC memakai
  `RatSpec` (BE) + `RatConfig` (skrip mock) — tiru `rapat-anggota-tahunan` bila perlu.

## Peta file

| Lapisan | File | Peran |
|---|---|---|
| Katalog | `packages/catalog/data/scenarios.json` | **sumber root** (id, title, difficulty, status) |
| DB | `apps/db/supabase/seed.sql` | GENERATED — jangan edit tangan; `pnpm --filter @simkop/db gen:seed` |
| DB | `apps/db/scripts/gen-seed.mjs` | generator seed; ada label `"Scenarios (N)"` yang di-hardcode |
| DB | `supabase/smoke/run.sh`, `tests/010-…`, `tests/020-…`, `tests/080-…` | guard jumlah skenario (`4` → bump) |
| BE | `apps/backend/voice_worker/scenarios.py` | `Scenario` dataclass + registry `_SCENARIOS` |
| BE | `apps/backend/voice_worker/prompts/<x>.py` | system prompt persona (satu konstanta `UPPER_SNAKE`) |
| BE | `docs/scenarios.md` | dokumen grounding (design) yang dirujuk prompt |
| BE | `apps/backend/api/server.py` | `VALID_SCENARIOS` (gerbang 422 `/token`) |
| BE | `apps/backend/CONTRACT.md` | daftar id (§1) + tabel taksonomi/skor (§6) |
| FE | `apps/web/src/scenarios/scenario.config.ts` | konfig kaya (kartu, misi, langkah, bukti) |
| FE | `apps/web/src/session/transport/contract.ts` | union `ScenarioId` |
| FE | `apps/web/src/session/transport/mock/scripts/<x>.script.ts` | skrip mock |
| FE | `apps/web/src/session/transport/mock/MockTransport.ts` | map `SCRIPTS` |
| FE | `apps/web/src/game/scenes/KoperasiInteriorScene.ts` | NPC + station (entry point di dunia) |
| FE | `apps/web/src/components/session/resultLabels.ts` | label untuk score/state key BARU |
| FE | `apps/web/src/scenarios/scenario.config.parity.test.ts` | parity + hitungan `toHaveLength(N)` |

---

## Langkah demi langkah (single-NPC)

### 1. Desain + pilih id
Tulis bagian `# SKENARIO N — <judul>` baru di **`docs/scenarios.md`** (persona, backstory,
grounding regulasi, jalur baik/buruk). Pilih `scenario_id` kebab-case (mis. `tarik-simpanan`).
Semua prompt & auditor di-grounding ke dokumen ini.

### 2. Katalog (sumber root)
Tambah satu entri di **`packages/catalog/data/scenarios.json`**:
```json
{ "id": "tarik-simpanan", "title": "Tarik Simpanan", "difficulty": "Menengah", "status": "AVAILABLE" }
```

### 3. DB (generated + guard hitungan)
```bash
pnpm --filter @simkop/db gen:seed        # regen seed.sql dari katalog — JANGAN edit seed.sql tangan
```
Lalu **bump hitungan `4` → `5`** di tempat berikut (semua mengasumsikan skenario AVAILABLE):
- `apps/db/scripts/gen-seed.mjs` — label `"Scenarios (4)"` → `"Scenarios (5)"`, lalu `gen:seed` lagi.
- `apps/db/supabase/smoke/run.sh` — assert `scenario_definition … = "4"`.
- `apps/db/supabase/tests/010-schema-smoke.sql` — `4::bigint`.
- `apps/db/supabase/tests/020-rls-isolation.sql` — `4::bigint`.
- `apps/db/supabase/tests/080-admin-metrics.sql` — `per_scenario has 4 rows`.

### 4. Backend — persona + registry
- Buat **`apps/backend/voice_worker/prompts/tarik_simpanan.py`** berisi satu konstanta:
  ```python
  """System prompt — Skenario N (Tarik Simpanan), NPC Bu Sari.
  Di-grounding ke docs/scenarios.md §Skenario N.
  """
  TARIK_SIMPANAN_PROMPT = """\
  Kamu adalah BU SARI, anggota koperasi yang ingin menarik simpanan pokok ...
  Tetap dalam karakter, bahasa Indonesia, 1–2 kalimat per giliran.
  """
  ```
- Di **`apps/backend/voice_worker/scenarios.py`**: import konstanta (dekat impor prompt
  lain), buat `Scenario(...)` (tiru `KREDIT_MACET`), dan daftarkan di `_SCENARIOS`.
  `voice_agent.py`/`observer.py`/`auditor.py`/`mentor.py` **tidak perlu disentuh** (generik).
- Di **`apps/backend/api/server.py`**: tambah id ke `VALID_SCENARIOS` (gerbang 422; test
  `tests/test_scenario_registry.py` memaksa `VALID_SCENARIOS == _SCENARIOS`).

### 5. CONTRACT
Di **`apps/backend/CONTRACT.md`**: tambah id ke daftar valid **§1**, dan satu baris di tabel
taksonomi/skor **§6** (scenario_id, State{nilai}, score keys, catatan NPC).

### 6. Frontend — konfig + entry point + skrip mock
- **`apps/web/src/session/transport/contract.ts`** — tambah literal id ke union `ScenarioId`.
- **`apps/web/src/scenarios/scenario.config.ts`** — tambah entri `ScenarioConfig` (tiru
  `kredit-macet`): `id`, `title`, `shortDescription`, `difficulty`, `status`, `npcName`,
  `blurb`, `mission`, `steps`, opsional `evidence`.
- **`apps/web/src/game/scenes/KoperasiInteriorScene.ts`** — tambah NPC + `Station` di
  `buildStations()` dengan `fire: () => gameStore.getState().openSession("tarik-simpanan")`,
  dan tambah id station ke union `StationKind`.
- **`apps/web/src/session/transport/mock/scripts/tarik-simpanan.script.ts`** — skrip mock
  (`satisfies ScenarioScript`): `greeting`, `npcTurns`, opsional `hints`/`drift`/
  `forceQuitLine`/`goalAtTurn`, dan `endings.good` (+ `endings.bad` bila bisa gagal).
- **`apps/web/src/session/transport/mock/MockTransport.ts`** — import skrip + tambah ke map `SCRIPTS`.
- **`apps/web/src/components/session/resultLabels.ts`** — HANYA jika Anda memakai score key
  atau state key/value BARU: tambah ke `SCORE_KEY_LABELS` / `STATE_KEY_LABELS` /
  `STATE_VALUE_LABELS` (parity test menolak key tanpa label).

### 7. Parity + verifikasi
- **`apps/web/src/scenarios/scenario.config.parity.test.ts`** — bump `expect(beIds).toHaveLength(4)` → `5`.
- Jalankan guard (ini yang menangkap apa pun yang terlewat):
  ```bash
  pnpm --filter @simkop/db check:parity         # seed vs katalog
  pnpm --filter web test                        # parity test: id FE == katalog == BE, label skor
  cd apps/backend && uv run pytest              # VALID_SCENARIOS == _SCENARIOS, registry
  cd apps/db && supabase start && pnpm --filter @simkop/db db:test   # pgTAP (butuh Docker)
  ```
- **Uji dua transport:**
  - mock: `apps/web` `pnpm dev` (default `VITE_TRANSPORT=mock`) → masuk koperasi, dekati NPC
    baru, jalankan sampai ending GOOD dan (ketik keyword escalate) sampai force-quit BAD.
  - livekit: jalankan `apps/backend` (worker + token server) + `apps/web` dengan
    `VITE_TRANSPORT=livekit` + `VITE_TOKEN_ENDPOINT` → NPC menyapa (~12–19 dtk), bicara/ketik,
    cek observer drift & AI Auditor di log worker.

---

## Spec acuan (field yang Anda isi)

### Backend `Scenario` (`scenarios.py`)
`scenario_id`, `npc_name`, `voice` (Azure Speech voice id), `prompt` (dari `prompts/`),
`greeting_instructions`, `mentor_brief` (grounding fitur Petunjuk), `drift: DriftSpec|None`,
`auditor: AuditorSpec|None`, `scripted_result` (hanya tanpa auditor, spt tutorial),
`rat: RatSpec|None` (multi-NPC), `goal_tool_prompt` (opsional sinyal "tujuan tercapai").

- **`DriftSpec`** (BE, dinilai LLM): `dimension` (teks bebas — apa yang dihitung "menyimpang",
  dan apa yang BUKAN, mis. "pertanyaan investigatif yang sah bukan penyimpangan"),
  `level1_streak`, `level2_streak` (semua skenario berskor pakai `2`/`4`).
- **`AuditorSpec`**: `taxonomy` (`State_X -> (nilai,...)`), `grounding` (regulasi),
  `style_anchor` (contoh nada few-shot), `score_keys` (dimensi skor 0–100).

### Frontend skrip mock (`script.types.ts`)
`greeting`, `npcTurns[]`, `hints?[]`, `drift?` (`DriftConfig`: `escalate[]`, `deescalate[]`,
`level1At`, `level2At` — **berbasis keyword**), `forceQuitLine?`, `goalAtTurn?`,
`endings.good` (+ `endings.bad?`). Ending = objek `AuditorResult` (`scores`,
`stateClassification`, `endingType`, `narrativeFeedback`).

> **Penting — dua model drift berbeda:** skrip mock memakai **daftar keyword**
> (`escalate`/`deescalate`); backend memakai **penilaian LLM** atas `dimension`. Jaga agar
> keduanya mencerminkan perilaku-menyimpang yang sama supaya kedua transport terasa konsisten.

---

## Checklist ringkas

```
[ ] docs/scenarios.md            — bagian # SKENARIO N
[ ] packages/catalog/data/scenarios.json  — entri baru
[ ] gen:seed                     — regen seed.sql
[ ] gen-seed.mjs                 — "Scenarios (N)" bump
[ ] smoke/run.sh                 — hitungan bump
[ ] tests/010, 020, 080          — hitungan bump
[ ] prompts/<x>.py               — konstanta prompt
[ ] scenarios.py                 — Scenario + import + _SCENARIOS
[ ] api/server.py                — VALID_SCENARIOS
[ ] CONTRACT.md                  — §1 daftar id + §6 tabel
[ ] contract.ts                  — union ScenarioId
[ ] scenario.config.ts           — ScenarioConfig
[ ] KoperasiInteriorScene.ts     — NPC + Station (+ StationKind)
[ ] mock/scripts/<x>.script.ts   — skrip
[ ] MockTransport.ts             — map SCRIPTS
[ ] resultLabels.ts              — label key BARU (jika ada)
[ ] scenario.config.parity.test.ts — toHaveLength(N)
[ ] verifikasi: parity + pytest + db:test + mock & livekit
```

## Catatan & jebakan

- **Ingin merilis FE lebih dulu?** Set `status: "COMING_SOON"` di katalog + konfig FE →
  assert "setiap skenario AVAILABLE punya worker BE" di-skip, tapi set-equality id (FE ==
  katalog == BE) tetap berlaku, jadi id tetap harus ada di ketiga tempat.
- **`scenario_id` tidak punya pola/regex yang dipaksa** — hanya set-equality lintas lapisan.
  Pertahankan konvensi kebab-case.
- **Skor render generik**, jadi key skor baru TIDAK memerlukan edit kode render — tapi
  WAJIB punya label di `resultLabels.ts` atau parity test gagal.
- **Jangan edit `seed.sql` tangan** — selalu lewat `gen:seed`; `check:parity` di CI akan
  gagal bila basi.
- **`voice_agent.py` tidak perlu diubah** untuk skenario single-NPC — semua lapisan
  (observer, auditor, Petunjuk, tiga jalur akhir) sudah generik atas spec.
