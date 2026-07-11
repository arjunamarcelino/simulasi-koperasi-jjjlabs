# CONTRACT.md — Kontrak Integrasi FE ↔ Backend

Sumber kebenaran wire antara Frontend (game `apps/web` maupun harness
`apps/web-sementara`) dan backend. Ini mengonkretkan PRD §9. Implementasi
referensi yang bekerja: `apps/web-sementara/src/transport/livekit/LiveKitTransport.ts`.

> Prinsip: **voice sebagai jalur utama, teks sebagai fallback** (PRD Prinsip 4).
> Keduanya masuk lewat jalur yang sama begitu sampai di agent.

---

## 1. Alur satu sesi

```
FE  POST /token {scenario_id}         → {token, room, url}
FE  room.connect(url, token)          (LiveKit client)
    → agent otomatis ter-dispatch ke room (bawa scenario_id)
    → agent join (~12–19 dtk), NPC menyapa (transkripsi + audio)
FE  ↔ agent: voice (mic) / teks (RPC send_text)
    agent → FE: transkripsi, attribute drift_level & phase, data message speaker
    sesi berakhir via 3 jalur → hasil AI Auditor → FE tampilkan
FE  room.disconnect()                 (sesi selesai; tak ada data disimpan)
```

Satu **room baru per sesi skenario** (nama unik `{scenario_id}-{uuid8}`). Ganti
skenario = token baru = room baru.

`scenario_id` yang valid:
`tutorial-koperasi-konsumen`, `kredit-macet`, `keanggotaan-fiktif`,
`rapat-anggota-tahunan`.

---

## 2. REST — token server

### `POST /token`
Request:
```json
{ "scenario_id": "kredit-macet" }
```
Response:
```json
{ "token": "<jwt>", "room": "kredit-macet-3a3c81a8", "url": "wss://...livekit.cloud" }
```
`GET /health` → `{ "status": "ok" }`. CORS diizinkan untuk origin di env
`CORS_ALLOW_ORIGIN` (default `http://localhost:5173`).

---

## 3. FE → Agent (RPC)

Panggil via `localParticipant.performRpc({ destinationIdentity, method, payload })`.
`destinationIdentity` = identity peserta **agent** (satu-satunya remote
participant; identity berawalan `agent-`, `kind` = agent). Tunggu agent join dulu.

| method | payload | balasan | keterangan |
|---|---|---|---|
| `end_session` | `""` | `AuditorResult` (JSON string) | "Keputusan Akhir" / "Bayar & Daftar". Jalur **manual**. Agent hentikan NPC & jalankan Auditor. |
| `send_text` | teks pemain | `"ok"` | Jalur fallback teks. Agent membalas seperti giliran suara. |
| `petunjuk` | `""` | `{ "hint": "..." }` (JSON string) | Fitur **Petunjuk** (menggantikan "Tanya Mentor", PRD §9). Mentor `gpt-5-mini` membaca transkrip → satu saran langkah berikutnya. Tak mengubah percakapan/ChatContext. Semua skenario. |
| `advance_phase` | `""` | `"ok"` / `"noop"` | **RAT saja.** Aksi agenda → maju satu fase. |

Setelah menerima balasan `end_session`, FE menampilkan hasil lalu
`room.disconnect()`.

---

## 4. Agent → FE (attribute, data message, transkripsi)

### 4a. Transkripsi (LiveKit native)
Kata-kata NPC & pemain datang lewat transkripsi LiveKit standar
(`RoomEvent.TranscriptionReceived`), streaming partial→final (`segment.final`).
Transkripsi TIDAK membawa identitas persona (semua dari satu participant agent) —
gunakan sinyal `speaker` (4d) untuk tahu siapa yang bicara.

### 4b. Participant attribute `drift_level` — indikator ketegangan (Lapisan 2)
`RoomEvent.ParticipantAttributesChanged` → `changed["drift_level"]` = `"0" | "1" | "2"`.
- `0` netral, `1` tegang (FE **dorong** pemain klik Keputusan Akhir),
  `2` maksimal (agent akan force-quit; lihat 4e).
Hanya skenario ber-drift (kredit-macet, keanggotaan-fiktif, rapat-anggota-tahunan).
Tutorial tak pernah mengirimnya (anggap 0).

### 4c. Participant attribute `phase` — state machine RAT (RAT saja)
`changed["phase"]` = JSON string:
```json
{ "phase": 1, "label": "Buka Rapat", "advanceActionLabel": "Baca LPJ" }
```
`phase` ∈ {1,2,3}; `advanceActionLabel` = teks tombol agenda berikutnya, atau
`null` di fase terakhir (pengakhiran diserahkan ke `end_session`).

### 4d. Data message topic `speaker` — SIAPA yang bicara
`RoomEvent.DataReceived`, `topic === "speaker"`, payload JSON:
```json
{ "name": "Pak Darma" }
```
Dikirim **tepat sebelum tiap giliran NPC bersuara** (sebelum kata pertama).
**Game WAJIB pakai ini** untuk memutuskan karakter mana yang ditampilkan/
dianimasikan bicara — jangan menebak dari timing. Kata-katanya dari transkripsi
(4a), identitas pembicaranya dari sini. Single-NPC mengirimnya sekali; RAT
mengirim ulang tiap ganti persona.

### 4e. Data message topic `session_ended` — force-quit (jalur c)
`topic === "session_ended"`, payload = `AuditorResult` JSON. Dikirim saat agent
mengakhiri sesi otomatis di **drift Level 2**. FE tampilkan hasil lalu disconnect.
(Untuk jalur **manual**, hasil datang sebagai balasan RPC `end_session`, bukan
data message ini.)

### 4f. Participant attribute `goal_reached` — tujuan skenario tercapai
`RoomEvent.ParticipantAttributesChanged` → `changed["goal_reached"]` = `"1"`.
Dikirim SEKALI saat agent menilai tujuan skenario sudah tercapai — untuk tutorial,
saat ibu (pelanggan) menyatakan **setuju** menjadi anggota (mendaftar + membayar
Simpanan Pokok). Agent memicunya lewat function-tool internal `catat_kesepakatan`.
FE memakainya untuk **membuka tombol akhir** ("Bayar & Daftar" / "Keputusan Akhir")
yang sebelumnya di-disable. Hanya skenario yang mendefinisikan sinyal ini
(saat ini: tutorial); skenario lain tak pernah mengirimnya.

---

## 5. Bentuk data

### `AuditorResult` (balasan `end_session` & payload `session_ended`)
```json
{
  "scenarioId": "kredit-macet",
  "trigger": "manual" | "force_quit_level_2",
  "stateClassification": { "State_Jalur_Remedi": "MELANGGAR_PROSEDUR", "...": "..." },
  "scores": { "member_centric": 40, "compliance": 35, "soft_skills": 30 },
  "endingType": "good" | "bad" | "neutral",
  "narrativeFeedback": "teks evaluasi Bahasa Indonesia"
}
```
Tutorial: `stateClassification` & `scores` = `{}` (pesan selamat terskrip).

### `PhaseState` (isi attribute `phase`, RAT)
```json
{ "phase": 1, "label": "Buka Rapat", "advanceActionLabel": "Baca LPJ" }
```

---

## 6. Taksonomi & skor per skenario (untuk render hasil)

| scenario_id | State (nilai mungkin) | score keys | catatan |
|---|---|---|---|
| `tutorial-koperasi-konsumen` | — | — | tanpa drift/auditor; attribute `goal_reached=1` saat ibu setuju (buka tombol) → sinyal selesai "Bayar & Daftar" (RPC `end_session`) |
| `kredit-macet` | `State_Analisis_Masalah`{BENAR,SALAH}; `State_Jalur_Remedi`{SESUAI,MELANGGAR_PROSEDUR,NAIF} | member_centric, compliance, soft_skills | NPC Pak Joko |
| `keanggotaan-fiktif` | `State_Verifikasi_Data`{DIBERSIHKAN,DIBIARKAN}; `State_Relasi_NPC`{TERJAGA,RUSAK} | integritas_data, compliance, soft_skills | NPC Pak Bambang. "Periksa Dokumen" = fitur FE statis |
| `rapat-anggota-tahunan` | `State_Proses_Rapat`{TUNTAS,BUBAR}; `State_Keabsahan_Keputusan`{SAH_DEMOKRATIS,TUNDUK_TEKANAN_MODAL,TIDAK_BERLAKU} | kepemimpinan, compliance, soft_skills | Dua NPC: Pak Darma & Ibu Sri. Fase 1→2→3 |

Skor 0–100. Nama key skor bisa berbeda antar skenario — render generik dari objek
`scores`, jangan hardcode nama key.

---

## 7. Tiga jalur akhir sesi (PRD §6)

1. **Manual** — FE panggil RPC `end_session` (kapan saja). Hasil = balasan RPC.
   `trigger = "manual"`.
2. **Sinyal Level 1** — attribute `drift_level` jadi `"1"`. FE **dorong** pemain
   (mis. sorot tombol Keputusan Akhir). Keputusan tetap di pemain; sesi belum berakhir.
3. **Force-quit Level 2** — attribute `drift_level` jadi `"2"`; agent mengakhiri
   otomatis → data message `session_ended`. `trigger = "force_quit_level_2"`.

Ketiganya memicu AI Auditor yang sama; yang beda hanya pemicu & bentuk pengiriman.

---

## 8. Catatan integrasi untuk FE game

- **Tunggu agent join** sebelum mengizinkan RPC / input. Sapaan NPC pertama =
  sinyal siap. RPC sebelum agent join akan gagal.
- **Mic non-wajib**: tangani izin mic yang ditolak/absen tanpa menjatuhkan sesi —
  teks tetap jalan (`send_text`).
- **Putar audio agent**: LiveKit client mentah tidak auto-play track remote —
  attach track audio ke elemen media (lihat `LiveKitTransport`). Untuk game,
  sinkronkan animasi bicara karakter ke aktivitas track audio + sinyal `speaker`.
- **RAT**: `phase` attribute menggerakkan indikator/tombol agenda; `speaker`
  menggerakkan karakter aktif; interupsi Fase 2 datang otomatis sebagai giliran
  NPC (speaker=Pak Darma).
- **Tanpa persistensi**: semua hilang saat room ditutup. Tak ada endpoint riwayat.
- Bentuk payload di sini adalah kontrak de-facto dari implementasi saat ini;
  perubahan wire harus memperbarui dokumen ini + `LiveKitTransport` bersamaan.
