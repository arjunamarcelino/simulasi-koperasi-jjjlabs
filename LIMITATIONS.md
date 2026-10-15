# Keterbatasan & Risiko Diketahui — Simulasi Koperasi v1 (SIM-35)

> Catatan **mandiri**. Dokumen ini sengaja **tidak menautkan** dokumen lain: sebagian
> dokumen kerja (reviews, brainstorms, plans, solutions) dihapus saat serah-terima,
> jadi setiap keterbatasan ditulis utuh di sini agar tetap benar tanpa rujukan luar.
> Format tiap entri: **Gejala · Dampak · Kenapa ada · Mitigasi/workaround**.

**Terakhir diverifikasi: 2026-10-16**

---

## A. Keterbatasan sistem terkirim (masih berlaku di v1)

### A1. Tidak ada cap durasi/idle sesi di voice worker
- **Gejala:** satu sesi suara bisa berjalan tanpa batas waktu dari sisi worker.
- **Dampak:** risiko biaya liar terbesar — menit STT + karakter TTS + detik LiveKit + token OpenAI terus terakumulasi pada sesi yang tak ditutup.
- **Kenapa ada:** `voice_worker/voice_agent.py` tidak menegakkan batas durasi/idle; hanya kontrol room LiveKit (`emptyTimeout`, `user_away_timeout`, `maxParticipants`, `delete_room_on_close`) yang tersedia.
- **Mitigasi:** setel kontrol room LiveKit secara agresif sekarang; tambah watchdog `asyncio` sisi-worker sebagai follow-up (ada di backlog HANDOVER P1).

### A2. Satu worker, tanpa autoscale
- **Gejala:** hanya satu GCE VM voice worker; token server dipatok `--max-instances=1`.
- **Dampak:** plafon konkurensi keras; lonjakan peserta melebihi kapasitas satu worker akan antre/gagal join.
- **Kenapa ada:** keputusan biaya + kesederhanaan untuk v1; juga backstop anti-flood anon.
- **Mitigasi:** untuk acara besar, naikkan ukuran VM / tambah worker manual terlebih dulu; rancang scale-out sebelum beban nyata.

### A3. Sign-in anonim = jalur financial-DoS langsung
- **Gejala:** anon sign-in membuka sesi suara berbiaya tanpa identitas nyata.
- **Dampak:** penyalahgunaan bisa membakar kuota Azure/LiveKit.
- **Kenapa ada:** game dirancang low-friction (tanpa wajib daftar).
- **Mitigasi:** WAJIB aktif **ketiganya** di produksi — Turnstile (secret di Supabase Auth), rate-limit anon Supabase, dan `--max-instances=1` Cloud Run. Jika salah satu mati, jalur biaya terbuka.

### A4. Kode unlock misi adalah "soft gate", bukan rahasia
- **Gejala:** kode seperti kode acara ikut ter-bundle di FE publik + ada di katalog bersama.
- **Dampak:** kode bisa dibaca siapa pun yang membuka bundle; bukan kontrol keamanan.
- **Kenapa ada:** sengaja — kode dicetak saat acara dan diketik peserta; diperlakukan sebagai gerbang lunak, bukan secret.
- **Mitigasi:** jangan andalkan kode sebagai keamanan; validasi kredit tetap server-authoritative.

### A5. Supabase Free tier: tanpa backup otomatis, PITR destruktif
- **Gejala:** tidak ada backup terjadwal; Point-in-Time Recovery bersifat in-place/destruktif.
- **Dampak:** kehilangan data bisa permanen tanpa snapshot manual.
- **Kenapa ada:** keterbatasan paket Free.
- **Mitigasi:** jadwalkan `pg_dump` manual berkala, atau naikkan paket sebelum go-live serius.

### A6. `pg_dump` tidak membawa role global `metrics_reader`
- **Gejala:** restore dari `pg_dump` tidak memulihkan role/password `metrics_reader`.
- **Dampak:** endpoint `/admin/*` 503 sampai password `metrics_reader` di-set ulang.
- **Kenapa ada:** role global berada di luar scope dump per-database.
- **Mitigasi:** setelah restore (atau re-apply `admin_metrics.sql`), set ulang password `metrics_reader` via SQL manual; username pooler wajib `metrics_reader.<project-ref>`.

### A7. `apps/admin` belum punya README
- **Gejala:** tidak ada README untuk app admin.
- **Dampak:** onboarding admin dashboard mengandalkan pembacaan kode.
- **Kenapa ada:** gap dokumentasi yang diketahui.
- **Mitigasi:** tulis README admin (kandidat backlog dokumentasi).

### A8. Mock adalah transport otoritatif untuk QA; jalur LiveKit non-deterministik
- **Gejala:** QA manual memakai mock sebagai oracle; jalur LiveKit nyata tidak menjadi blocker rilis.
- **Dampak:** regresi spesifik-LiveKit bisa lolos QA terstruktur.
- **Kenapa ada:** LiveKit butuh kredensial nyata + non-deterministik (latensi, join ~12–19 dtk).
- **Mitigasi:** smoke test LiveKit manual terpisah sebelum acara; perlakukan hasil LiveKit sebagai best-effort.

### A9. Permukaan stub/belum terjangkau
- **Gejala:** `EvaluationPage`, `GamePage`, dan beberapa room berstatus COMING_SOON.
- **Dampak:** navigasi ke sana menampilkan placeholder, bukan fitur.
- **Kenapa ada:** dipotong/ditunda untuk v1.
- **Mitigasi:** sembunyikan/label jelas di UI; masuk backlog bila akan diaktifkan.

### A10. Google OAuth tidak ter-wire di konfigurasi default
- **Gejala:** login Google bersifat best-effort, tidak aktif pada konfigurasi lokal default.
- **Dampak:** hanya email/anon yang jalan out-of-the-box.
- **Kenapa ada:** butuh konfigurasi provider di dashboard Supabase.
- **Mitigasi:** konfigurasikan provider Google di Supabase bila dibutuhkan; jangan asumsikan tersedia.

### A11. `resultLabels.ts` adalah superset label
- **Gejala:** ada nilai label yang tidak pernah di-emit oleh skrip skenario mana pun.
- **Dampak:** oracle tes yang diturunkan dari peta label (bukan dari skrip) bisa menghasilkan FAIL palsu.
- **Kenapa ada:** peta label lebih luas daripada ending yang benar-benar diproduksi skrip.
- **Mitigasi:** turunkan outcome yang diharapkan dari GOOD_ENDING/BAD_ENDING skrip, bukan dari peta label.

### A12. Kontainer backend (SIM-26) belum terverifikasi end-to-end
- **Gejala:** registrasi job LiveKit + voice E2E belum diverifikasi tanpa kredensial nyata.
- **Dampak:** "build & run hijau" tidak menjamin worker benar-benar join + bicara.
- **Kenapa ada:** verifikasi penuh butuh kredensial LiveKit/Azure produksi.
- **Mitigasi:** jalankan smoke E2E bersuara dengan kredensial nyata sebelum go-live.

---

## B. Sharp edges / jebakan operasional (bug lama sudah diperbaiki, tapi footgun-nya tetap menggigit)

### B1. `guard-secrets` mencocokkan NAMA var, bukan nilai kunci
- Guard CI mendeteksi string nama (mis. `service_role`) — **bukan** material kunci. Hijau ≠ aman. Jangan pernah menulis bentuk *assignment* nama-var-rahasia diikuti nilai di file apa pun (termasuk `.md`; guard memindai `*.md` tanpa pengecualian).

### B2. `LIVEKIT_AGENT_NAME` tidak sinkron = hang senyap
- Jika nama agent beda antara token server dan worker, token tetap ter-mint tetapi worker **tidak pernah join**. Tidak ada error keras — hanya sesi yang menggantung. Pastikan nilainya byte-identik di kedua proses.

### B3. `/health` config-blind; `:8081` liveness ≠ readiness
- `/health` selalu 200 walau env hilang; health worker `:8081` hanya liveness proses framework, bukan tanda siap. Uptime check harus menguji `/token` (mis. assert 401, bukan 500), bukan `/health`.

### B4. Keep-alive cron hanya fire dari default branch
- Workflow keep-alive tidak berjalan dari PR `develop` sampai `develop` jadi default branch. Prasyarat operasional yang mudah terlewat.

### B5. Drift tiga validator: SQL floor / Pydantic / parser klien
- Tiga lapis validasi di tiga boundary bisa berbeda ketat-longgarnya; jalur seed mem-bypass Pydantic sehingga hanya DB floor yang menjaganya. Jaga agar ketiganya setara saat mengubah skema/katalog.

### B6. Duplikasi katalog FE ↔ DB seed
- Data katalog ada di array FE dan seed DB; kopling hanya lewat paket `@simkop/catalog`. Impor JSON butuh `with { type: "json" }`. Jika menambah baris katalog, perbarui asersi jumlah-baris (smoke/pgTAP memakai literal hard-coded, bukan turunan katalog).

### B7. Validasi fail-soft JSON dari LLM
- Validasi pakai Pydantic `mode="before"` (`mode="after"` berjalan setelah type-enforcement → nilai salah-tipe raise lebih dulu). `json.loads` menerima `Infinity`/`NaN`/int presisi-arbitrer secara default → `int(float('inf'))` raise `OverflowError` (bukan `ValueError`) yang lolos dari except per-key.

### B8. FastAPI: dependency auth resolve SEBELUM validasi param
- `solve_dependencies` jalan lebih dulu → 422 param-type tidak mungkin muncul sebelum 401/403. Jangan mengandalkan asumsi "422 dulu baru auth".

### B9. asyncpg: bind `sub` (str) ke param `uuid` = 503 senyap
- Meneruskan JWT `sub` (string) ke param `uuid` definer menghasilkan 503 opaque, bukan error bind yang jelas. Cast di SQL (`$N::uuid`) agar bug bind terlihat.

### B10. RPC hanya tersedia setelah agent join (~12–19 dtk)
- Ada jeda join; API worker memakai `AgentServer` (bukan `WorkerOptions`); referensi `asyncio.create_task` wajib disimpan agar task tidak di-GC. Perhatikan juga drift hook/hosted Supabase.

---

## C. Katalog risiko regresi (kelas bug yang pernah menggigit)

Kelas-kelas bug ini pernah terjadi; pengujian regresi harus menutupinya. (Pemetaan "di mana menangkapnya" ada di appendix QA pada `docs/qa/manual-qa-regression-checklist.md`.)

- **Drift config-key FE↔BE** — raw key ter-render alih-alih label.
- **Drift katalog (FE ↔ seed DB)** — dua salinan tangan menyimpang diam-diam.
- **DB floor lebih longgar dari parser klien (mading)** — baris seed bisa merusak board.
- **Race siklus-hidup auth** — multi-tab, OAuth, perubahan nama; deadlock lock GoTrue reentrant.
- **Turnstile single-use / CSP / env** — token dipakai ulang, frame-src CSP memblokir iframe, fitur mati senyap saat env hilang.
- **Scoping keyboard-nav overlay / kebocoran Phaser** — fokus pindah ke tombol close; Phaser menonaktifkan keyboard global saat overlay.
- **Rekonsiliasi wallet server / free-credit** — edit optimistik gagal rekonsiliasi senyap.
- **Kode reallife free-credit offline** — jalur offline memberi kredit tanpa gerbang klien.
- **Admin re-seed menimpa nilai yang dirotasi** — INSERT seed harus `ON CONFLICT ... SET` kolom mutable.
- **Gate capture leaderboard dibuka ulang oleh read** — trigger read membatalkan write in-flight.
- **Baris OPEN sesi orphan** — write dua-langkah non-atomik meninggalkan baris menggantung.
- **Admin JWT hook / retry konkuren / bind asyncpg** — hook tak fire lokal; singleton non-reentrant race; bind str→uuid.
- **Footgun setup CI E2E/Supabase** — `webServer` boot sebelum `globalSetup`; `--port` bocor ke vite; rate-limit Docker Hub; glob spec Vitest menangkap Playwright.
- **Nilai oracle label-only di `resultLabels.ts`** — turunkan outcome dari skrip mock, bukan peta label.
