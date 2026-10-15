# Manual QA Test Plan & Regression Checklist — Koperasi Simulator

> Repeatable manual QA pass for validating a release. The voice pipeline can't be fully
> automated, so this checklist is the human-run counterpart to CI (Vitest, Playwright
> smoke, pytest, pgTAP). A tester following this doc should be able to validate a build
> **without tribal knowledge**.

Linear: [SIM-24](https://linear.app/simulasi-koperasi/issue/SIM-24/docs-manual-qa-test-plan-regression-checklist) ·
Plan: `docs/plans/2026-10-14-docs-manual-qa-test-plan-regression-checklist-plan.md`

---

## §1 — Purpose, scope & how to run

**When to run:** before every release, and in full before a handover.

**Strategy & scope:**
- **Mock mode is authoritative.** All P0/P1 checks run against `VITE_TRANSPORT=mock` (offline, deterministic — the repo default). LiveKit and Admin are documented but **skippable** (see their sections) and are **not release-blocking**.
- **In scope:** `apps/web` (game), `apps/admin` (dashboard), local Supabase persistence, backend `/admin/*` (for the Admin section).
- **Out of scope:** `apps/web-sementara` (throwaway voice-pipeline validator).
- **Keep this doc alive:** update it after each feature/release. A stale checklist produces false failures and gets abandoned.

**Release bar (minimum GO):** the **Smoke script (§4) passes** AND **all four scenarios (mock) reach a scored/scripted result (§5)**, with auth (§6) and core gamification (§7) working. Admin (§9) and LiveKit (§11) are best-effort.

**Priority tiers** — run top tiers first under time pressure:
- **P0** — release-gating: §4 smoke + §5 scenarios reaching a scored result.
- **P1** — §6 auth, §7 economy, §8 overlay invariants.
- **P2** — §9 admin, §10 leaderboard, §11 LiveKit, stub/edge surfaces.

**Result vocabulary** (use in the §12 run-log): **Pass** / **Fail** / **Blocked** (prerequisite unavailable) / **N/A** (out of scope this run). Record evidence (note or screenshot) for every Fail.

**Browser:** Chrome desktop only (matches the Chromium e2e target).

---

## §2 — Environment setup runbook

The regression run targets **local Supabase (CLI)** + a **local prod preview** (`pnpm build && pnpm preview`) in **mock** transport. Env vars are read via `import.meta.env.VITE_*` and **must be set at build time** — a preview build bakes them in; `pnpm preview` alone does not read them.

```bash
# ── 1. Start local Supabase (generated seed.sql runs automatically on start) ──
cd apps/db && supabase start
supabase status -o env        # capture API_URL and ANON_KEY (and the DB URL)

# Capture the DB URL for the psql + orphan-check steps below:
export LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
# (confirm host/port against `supabase status`; the DB URL line is also shown there)

# ── 2. Seed an admin (NOT auto-run — the FK to auth.users needs an existing user) ──
#   a. Create an EMAIL user in Supabase Studio → Authentication → Add user.
#      (An anonymous/guest user CANNOT be promoted this way — it has no login to re-mint a JWT.)
#   b. Get its uid:
#        psql "$LOCAL_DB_URL" -c "select id, email from auth.users;"
#   c. Seed it as admin:
#        psql "$LOCAL_DB_URL" -v uid="<that-uuid>" -f supabase/seeds/dev_admins.sql
#   d. Re-login (sign out + in) so the custom access-token hook re-mints the JWT with is_admin:true.
#      After migrating the hook locally the first time, run:
#        supabase stop && rm -rf supabase/.temp && supabase start
#      (GoTrue re-reads hook config on `start`, not on `db reset`.)

# ── 3. Build + preview the WEB game (mock transport). Env MUST precede the build. ──
cd ../..                       # repo root
VITE_TRANSPORT=mock \
VITE_SUPABASE_URL=<API_URL> \
VITE_SUPABASE_ANON_KEY=<ANON_KEY> \
pnpm build && pnpm preview     # root scripts target apps/web
# Load the preview URL Vite prints (default http://localhost:4173/). Use THIS, not the dev server.

# ── 4. (Admin section only) run backend + admin app ──
#   Backend (apps/backend) must expose /token and /admin/* against the same local Supabase.
VITE_ADMIN_API_ENDPOINT=<backend-url> \
VITE_SUPABASE_URL=<API_URL> VITE_SUPABASE_ANON_KEY=<ANON_KEY> \
pnpm --filter admin build && pnpm --filter admin preview
```

**Env var reference**

| Var | Used by | Purpose / default |
|---|---|---|
| `VITE_TRANSPORT` | web | `mock` (default) vs `livekit` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | web, admin | unset → null client → **DEGRADED** mode |
| `VITE_TURNSTILE_SITE_KEY` | web | optional; unset → tokenless anon sign-in (local default) |
| `VITE_TOKEN_ENDPOINT` | web (livekit) | LiveKit token endpoint |
| `VITE_ADMIN_API_ENDPOINT` | admin | backend `/admin/*` base |

**Setup caveats**
- **Google OAuth is not wired** in the default local `apps/db/supabase/config.toml` (`[auth.external.google]` commented). Anonymous/guest is fully testable; **Google OAuth is best-effort** (needs the provider block + client id/secret).
- The **Admin section (§9) requires the backend running** too. If the backend is unavailable, mark §9 **Blocked** / SKIP — not release-blocking.
- If env is left unset, the app boots in **DEGRADED** mode (device-local wallet). That is a valid test target for §6, but §7 server-persistence and §9/§10 require **Supabase up**.

---

## §3 — Known-good oracle (expected outcomes per scenario)

**How to drive a conversation in mock:** type a message into the **text input** and send it. The mic button is a **visual no-op** ("Mic dinyalakan (mock — tidak merekam)"). Keywords below are matched as **case-insensitive substrings** of your message.

**Drift model** (verified in `apps/web/src/session/transport/mock/MockTransport.ts:283-345`):
- Each **escalate** keyword → `driftScore += 1`; each **de-escalate** keyword → `driftScore = max(0, driftScore − 1)`.
- Level per message: `driftScore ≥ 4 → 2`, `driftScore ≥ 2 → 1`, else `0`. **The three scored scenarios (kredit-macet, keanggotaan-fiktif, RAT) use `level1At = 2`, `level2At = 4`; the tutorial has no drift model** (no `drift` block → no bad path, no force-quit, `debugSetDrift` driftScore is a no-op).
- Reaching **level 2** → **force-quit**: streams the `forceQuitLine`, then the input is **locked** (`sendText` ignored).
- Ending: `wantBad = force_quit OR driftLevel ≥ 1` → picks the scenario's `bad` ending if defined, else `good`.
- Debug hook `debugSetDrift(level)` can force any level (2 ⇒ force-quit).

**Scores are CANNED** — each script hardcodes its GOOD/BAD `scores` and `stateClassification`. De-escalate words **do not raise scores**; they only hold `driftScore` down. So the keyword lists in the GOOD column are *optional drift-reducers*, not a required script — a GOOD run only needs to **avoid reaching `driftScore` 2**.

**Three outcomes to understand:**
- **1 escalate word** → `driftScore 1` → level **0** → still **GOOD** at a manual end action.
- **2 net escalate words** → `driftScore 2` → level **1** → press the end action → **BAD** (no force-quit).
- **4 net escalate words** → `driftScore 4` → level **2** → immediate **force-quit** (BAD), input locked.

**Ending tones** (`resultLabels.ts`): `good → "Berhasil"` (forest), `neutral → "Selesai"` (mustard), `bad → "Berakhir"` (orange).

**Station / NPC → scenario map** (where to start each, in the hub):

| Scenario id | Started from |
|---|---|
| `tutorial-koperasi-konsumen` | NPC **"Pelanggan"** (Ibu Rumah Tangga) station |
| `kredit-macet` | NPC **"Pak Joko"** station |
| `keanggotaan-fiktif` | **Ruang Rapat** room → picker card "Keanggotaan Fiktif" |
| `rapat-anggota-tahunan` | **Ruang Rapat** room → picker card "Rapat Anggota Tahunan" |

**Oracle table:**

| Scenario (id) | End action | GOOD path (keep `driftScore < 2`; optional de-escalate words) | GOOD result | BAD path (escalate words) | BAD result |
|---|---|---|---|---|---|
| Tutorial — Koperasi Konsumen (`tutorial-koperasi-konsumen`) | "Bayar & Daftar" | Send any 4 messages → goal fires at turn 3 (`gatesEndOnGoal`) | `good`, **no score chips** (scripted congrats) | — (no bad path in mock) | — |
| Kredit Macet (`kredit-macet`) | "Keputusan Akhir" | bantu, paham, keringanan, restrukturisasi, perpanjang, solusi, tenang, musibah | Analisis Masalah=**BENAR**, Jalur Remedi=**SESUAI**; member_centric 88 / compliance 82 / soft_skills 79 | sita, ancam, polisi, usir, bayar sekarang, paksa, lelang, rampas | Analisis=**SALAH**, Remedi=**MELANGGAR_PROSEDUR**; 35/30/28 |
| Keanggotaan Fiktif (`keanggotaan-fiktif`) | "Keputusan Akhir" | verifikasi, cek ulang, cocokkan, ketua rt, bereskan, hak anggota, shu, tolong, paham | Verifikasi Data=**DIBERSIHKAN**, Relasi=**TERJAGA**; integritas_data 88 / compliance 84 / soft_skills 82 | pencuri, korupsi, penjara, pidana, pecat, lapor polisi, palsu, tipu, maling | Verifikasi=**DIBIARKAN**, Relasi=**RUSAK**; 32/30/25 |
| Rapat Anggota Tahunan (`rapat-anggota-tahunan`) | "Ketok Palu" | tata tertib, satu suara, satu orang satu suara, voting, pemungutan suara, musyawarah, aturan, kuorum, adil, tenang | Rapat **TUNTAS**, **SAH_DEMOKRATIS** (good) | bodoh, diam, tutup mulut, usir, keluar kamu, pengecut, serakah, brengsek, tarik saja modalmu, silakan tarik, tantang | Rapat **BUBAR**, **TIDAK_BERLAKU** (renders "Tidak Berlaku"; bad, force-quit) |

RAT is a **3-phase state machine** (not linear): P1 "Membuka Rapat" (advance: "Ketok Palu: Buka Rapat") → P2 "Pembacaan LPJ & Interupsi" (advance: "Lanjut: Ambil Keputusan"; Pak Darma's capital-pull threat fires as an entry event) → P3 "Mengambil Keputusan" (end via "Ketok Palu"). Dual-NPC routing: mention **"Pak Darma"** or **"Ibu Sri"** to pick the speaker.

---

## §4 — Smoke script (~5 min · P0 · release gate)

> **Gate rule:** any Smoke failure = **NO-GO**. Stop — do not run deeper regression on a build that fails smoke.

Preconditions: single browser tab, no other session open, Supabase up, built with the §2 env.

- [ ] **0. Main menu** `[P0]` — preview URL loads to the Main Menu. Clicking "Mulai Bermain" **and** pressing Enter both start the game.
- [ ] **1. Loading** `[P0]` — the loading screen plays (progress bar + rotating koperasi facts) and **auto-advances** to the hub (no manual click, no hang).
- [ ] **2. Guest sign-in** `[P0]` — auth status reaches **guest** silently (never displays DEGRADED). No splash→degraded→guest flash.
- [ ] **3. Hub + interact** `[P0]` — hub renders; walk with arrows/WASD to **Pak Joko**; the prompt "Tekan E — ..." appears; press **E** to open the scenario.
- [ ] **4. Scored run** `[P0]` — run the kredit-macet **GOOD** path (§3) → press "Keputusan Akhir" → `ResultPanel` shows a scored result with **human-labeled** state chips + score dimensions.
- [ ] **5. History** `[P0]` — reopen Profil/Riwayat → the session appears in history.
- [ ] **6. Persistence** `[P0]` — verify no orphan session was left. Scope the query to this run (single tab, no other open session):
      ```bash
      psql "$LOCAL_DB_URL" -c "select count(*) from public.sessions where ended_at is null;"
      ```
      Expected **0** (if other tabs/sessions are open this may legitimately be non-zero — close them first).
- [ ] **7. Console baseline** `[P0]` — DevTools console shows **no uncaught errors** during the smoke run.

---

## §5 — Scenario checklists (mock · P0)

**Run order & mode:** Supabase **up** (not degraded). Each scenario produces a persisted session.

**Cross-cutting assertions (apply to every scored scenario):**
- [ ] **Label render** `[P0]` — ResultPanel chips show **human labels** (e.g. "Benar", "Sesuai Prosedur", "Berhasil"), **not** raw keys like `State_Analisis_Masalah` or bare `kepemimpinan`. (Guards FE↔BE config-key drift.)
- [ ] **BAD via manual end** `[P0]` — send **2** escalate words (reach level 1, no force-quit) then press the end action → **BAD** ResultPanel.
- [ ] **BAD via force-quit** `[P0]` — send **4** escalate words (or `debugSetDrift(2)`) → `forceQuitLine` streams, ResultPanel is BAD, and the **input is locked** (further sends produce no NPC reply).
- [ ] **Interrupted session** `[P1]` — start a scenario, send one message, then close the overlay / reload the page mid-conversation → reopen → **no orphan row** (§4 step 6) and the session is cleanly closed. Expected resume/restart behavior: _record what you observe_.
- [ ] Evidence panel ("Periksa Dokumen"/"Periksa Bukti") opens and shows content; "Petunjuk" (hint) returns a hint.

**Per scenario:**
- [ ] **Tutorial — Koperasi Konsumen** `[P0]` — send 4 messages → goal fires → "Bayar & Daftar" → `good` ending. **No score chips, no bad path — do NOT Fail for missing scores.**
- [ ] **Kredit Macet** `[P0]` — GOOD path → BENAR/SESUAI + 88/82/79; both BAD routes → SALAH/MELANGGAR_PROSEDUR + 35/30/28.
- [ ] **Keanggotaan Fiktif** `[P0]` — GOOD path → DIBERSIHKAN/TERJAGA + 88/84/82; BAD → DIBIARKAN/RUSAK + 32/30/25.
- [ ] **RAT (expanded)** `[P0]`:
  - [ ] Ruang Rapat **picker** shows two cards ("Rapat Anggota Tahunan" + "Keanggotaan Fiktif" — the cards render the full `scenario.title`); locked cards (if any) are visibly locked.
  - [ ] P1 → P2 transition fires on "Ketok Palu: Buka Rapat".
  - [ ] P2 **entry event** appears (Pak Darma threatens to pull capital).
  - [ ] Naming "Pak Darma" / "Ibu Sri" routes the reply to that speaker.
  - [ ] The end action "Ketok Palu" is available **only in P3**.
  - [ ] GOOD → TUNTAS / SAH_DEMOKRATIS. BAD → BUBAR / TIDAK_BERLAKU, reachable two ways (like the other scored scenarios): **2 net escalate words + "Ketok Palu" in P3** (level 1, no force-quit) *or* **4 net escalate words** (level 2 → force-quit).

**Stubs — do NOT test:** the `EVALUATION` view is never navigated to (no `setView("EVALUATION")` exists) — `EvaluationPage` is an unreachable placeholder, distinct from the in-session `ResultPanel`. `GamePage` is likewise a stub (all rooms launch a session). Flag these to the team; don't log them as scenario failures.

---

## §6 — Auth flows (P1)

Refs: `apps/web/src/stores/auth.store.ts`, `apps/web/src/lib/captcha.ts`.

- [ ] **Anon guest on boot** `[P1]` — status reaches **guest**. Open a **second tab** at the same time → both are guests, no mutual interference (Web Lock `koperasi.reanon` elects one re-anon tab).
- [ ] **Degraded path** `[P1]` — launch a build with Supabase env **unset** → status flips to **DEGRADED** within ~3s, device-local wallet, app still playable in mock.
- [ ] **No-flash boot** `[P1]` — the status indicator reaches `guest` without ever displaying `DEGRADED`. (If hard to observe, throttle the network or watch the auth status store.)
- [ ] **Turnstile** (if `VITE_TURNSTILE_SITE_KEY` set) `[P2]` — quick sign-in < 2s, no splash→degraded→guest flash; two rapid sign-ins both succeed (single-use token, no re-serve); no CSP `frame-src` console errors.
- [ ] **Google OAuth** (best-effort — needs provider wired) `[P2]` — nav state (current view + selected scenario) is restored across the redirect; display name persists after reopen; closing the tab mid-OAuth leaves a fully-anon **or** fully-upgraded state (no half-state); a guest→Google upgrade keeps the **same uid** (wallet preserved).

---

## §7 — Gamification / economy (P1)

**Mode:** Supabase **up** (server-authoritative). Refs: `apps/web/src/stores/game.store.ts`, `lib/*`, `content/*`.

- [ ] **Fresh guest baseline** `[P1]` — a new guest starts at **0 XP / 0 points** (no handout).
- [ ] **Quiz** (`QUIZ` overlay) `[P1]` — submit answers → server-authoritative grading; **two-pass**: resubmit with more correct answers → only the **newly-correct delta** is credited (no double credit). Terminal/retry UI states: offline → degraded; retryable → "Coba Lagi"; empty → "Gagal memuat kuis."
- [ ] **Voucher** (`KASIR_VOUCHER`) `[P1]` — redeem gates on balance → optimistic debit → server reconcile + server-minted code. **Insufficient balance** → blocked with message, **no debit**. Reject → rolls back.
- [ ] **Missions** (`MISSION`) `[P1]` — game missions credit optimistically. Reallife codes are **server-validated**:
  - [ ] valid code (e.g. `KDMP2026`) → credited;
  - [ ] wrong code → `wrong-code`;
  - [ ] redeem a valid code twice → `already`;
  - [ ] empty field → blocked;
  - [ ] offline → `degraded` (no free credit).
- [ ] **Badges** `[P1]` — surface after meeting criteria (level / missions / vouchers / points / good-ending / content-read).
- [ ] **Wallet persistence** `[P1]` — earn points → close & reopen the tab → wallet unchanged (persisted server-side).
- [ ] **Owner reconciliation** `[P1]` — on a uid transition there is **no cross-account flash**; a guest→Google upgrade preserves the wallet (only XP + game-mission state migrate; point/vouchers intentionally dropped).
- [ ] **Catalog parity** `[P1]` — vouchers / missions / badges shown in-game match the shared `@simkop/catalog` (and admin content) — no missing or extra items, reward/cost/criteria consistent.
- [ ] **Empty history** `[P2]` — a brand-new guest's history is empty (don't assume a session exists).

---

## §8 — Overlay / interaction & spatial layer (P1)

Refs: `apps/web/src/stores/game.store.ts`, `game/scenes/{VillageScene,KoperasiInteriorScene}.ts`.

**Invariants:**
- [ ] **Mutual exclusion** `[P1]` — only one overlay opens at a time (opening is a no-op while another is up).
- [ ] **E-suppression** `[P1]` — close an overlay with **E** → the station under the player does **not** immediately re-fire (`INTERACT_SUPPRESS_MS = 250`).
- [ ] **Carousel keyboard nav** `[P1]` — open a mading carousel → arrow keys work on the **first** keypress; arrows do **not** pan the Phaser camera or scroll the page beneath.

**Spatial transitions:**
- [ ] **Village → interior** `[P0]` — Village renders; door prompt "Tekan E" appears; E enters the koperasi; SceneLoadingOverlay trivia plays.
- [ ] **Interior → Village** `[P1]` — the exit door returns to Village (trivia plays); the player respawns at the doorstep.

**Overlay surfaces (open + render):**
- [ ] **PROFILE** `[P1]` — opens; shows display name + points/wallet.
- [ ] **MADING_INFO** `[P2]` — "Papan Info" renders header + corkboard notes.
- [ ] **MADING_KNOWLEDGE** `[P2]` — "Info Koperasi" board renders; reading it awards the content-read badge.
- [ ] **MADING_DATA** `[P2]` — data board renders parsed items (no raw/garbled markup).
- [ ] **COMING_SOON** `[P2]` — stub rooms (Marketplace / Kasir / Gudang) open the "Segera hadir!" overlay.
- [ ] **Mading parse / error fallback** `[P2]` — complex boards render fully; a malformed/unloadable board shows **"Gagal memuat papan."** rather than crashing. (Guards DB-floor-vs-client-parser drift.)

---

## §9 — Admin (P2 · requires backend + admin seed, else Blocked/SKIP)

**Preconditions:** §2 steps 2a–2d done (email user seeded as admin **and re-logged-in**) **and** backend up. If not, mark the whole section **Blocked** — it is non-blocking for release. Refs: `apps/admin/src/components/dashboard/*`, `apps/backend/api/server.py`.

- [ ] **Role gate** `[P2]` — admin login succeeds; the JWT carries `is_admin:true`. A non-admin / anonymous user hits the **NotAuthorized (403)** screen with a refresh-and-retry affordance.
- [ ] **Metrics** `[P2]` — KPI cards + ending split render (`GET /admin/metrics`); scenario table drill-down loads (`/admin/scenarios/{id}/analytics`).
- [ ] **Quiz / Mading CRUD** `[P2]` — create / edit / delete work. **CAS conflict**: edit the same record in two tabs → the second (stale) save is **rejected with a conflict message** (compare-and-swap on `prev_updated_at`).
- [ ] **Mission redeem-code rotate + re-seed durability** `[P2]` — rotate a mission's redeem code (`POST /admin/missions/{code}`), then run a re-seed (`supabase db reset`) → the rotated code **persists** (not clobbered to the catalog value).
- [ ] **CSV export** `[P2]` — `GET /admin/reports/sessions.csv` opens in Excel (BOM present); cells starting with `= + - @` are apostrophe-prefixed (injection-safe). An empty `?from&to` range returns **header-only** (not an error).

---

## §10 — Leaderboard (P2)

- [ ] **Empty state** `[P2]` — before any scored session/season the in-game "Papan Juara" shows an empty/placeholder state (expected, not a bug).
- [ ] **In-game render** `[P2]` — `MADING_LEADERBOARD` renders the latest season **top 20**; a player who finished a scored session appears.
- [ ] **Error fallback** `[P2]` — an unloadable board shows **"Gagal memuat papan juara. Coba lagi nanti."**
- [ ] **Admin capture** `[P2]` — `POST /admin/leaderboard/capture` freezes a new season (**top 100**). Note: display top-20 vs capture top-100 is **expected**, not a count mismatch.
- [ ] **Capture race** `[P2]` — start a capture, then switch the season dropdown mid-flight → the switch is blocked/ignored, the capture still completes with a success toast, and a second capture is not possible mid-flight (button disabled).
- [ ] **Delete season** `[P2]` — `DELETE /admin/leaderboard/seasons/{id}` cascades its entries; frozen name/xp/rank preserved for deleted players.

---

## §11 — LiveKit / voice (P2 · SKIP if creds/backend unavailable)

**Non-release-blocking.** Requires `VITE_TRANSPORT=livekit` + backend token server + voice worker + Azure/LiveKit env. Because the real auditor is **non-deterministic**, assert on **goal / path / ending-class**, not exact wording. Run each voice case **3–5 times** and record a **pass-rate** (e.g. 4/5) against a threshold; capture the transcript as evidence; turn real failures into new scripted cases.

Split checks (so a partial result is still informative):
- [ ] Token issued (`/token`, Supabase-JWT-gated).
- [ ] Voice worker connects (NPC joins the room).
- [ ] STT round-trip (your speech is transcribed).
- [ ] TTS plays (NPC speaks back).
- [ ] Auditor returns a scored result at the end action.
- [ ] Result maps to the **same state keys** as mock (`resultLabels.ts`) — labels render, not raw keys.
- [ ] **Watchdog / error UI** — if the agent doesn't join, SessionOverlay shows **"Agen NPC tidak merespons. Pastikan backend berjalan, lalu coba lagi."**; `connection === "error"`/"ended" states render cleanly.

---

## §12 — Regression run-log

Copy the block below per run. Bind each run to an **immutable commit SHA**.

```markdown
### Run — <YYYY-MM-DD> · build <git sha> · ver <app/build version> · tester <name> · run-id <n>
Env: local Supabase (CLI) + local prod preview · transport: mock · browser: Chrome desktop

| Area | Mode (up/degraded) | Result (Pass/Fail/Blocked/N-A) | Notes / defect link |
|---|---|---|---|
| §4 Smoke script (gate) | up | | |
| §5 Tutorial | up | | |
| §5 Kredit Macet (good/bad×2) | up | | |
| §5 Keanggotaan Fiktif (good/bad) | up | | |
| §5 RAT (phases/good/bad) | up | | |
| §6 Auth flows | up + degraded | | |
| §7 Gamification/economy | up | | |
| §8 Overlay + spatial | up | | |
| §9 Admin | up (+backend) | | |
| §10 Leaderboard | up | | |
| §11 LiveKit/voice (pass-rate N/5) | livekit | | |

**Release verdict:** GO / NO-GO
**Bar:** Smoke green + all four scenarios scored (admin & LiveKit non-blocking).
**If GO-with-risk:** waiver owner = <name> · known issues: <list>
```

---

## Appendix — Known risk areas

These are classes of bugs that have bitten before; the checks above are mapped to them.
Full descriptions of each risk live in `LIMITATIONS.md` (§C); this table keeps the QA-section mapping.

| Risk | Where to catch it |
|---|---|
| FE↔BE config-key drift (raw keys instead of labels) | §5 label-render |
| Catalog drift (FE ↔ DB seed) | §7 catalog parity |
| DB floor weaker than client parser (mading) | §8 mading parse / error fallback |
| Auth lifecycle races (multi-tab, OAuth, name) | §6 |
| Turnstile single-use / CSP / env | §6 Turnstile |
| Overlay keyboard-nav scoping / Phaser leak | §8 carousel nav |
| Wallet server reconciliation / free-credit | §7 baseline + persistence |
| Reallife code offline free-credit | §7 missions |
| Admin re-seed clobbers rotated value | §9 redeem-code durability |
| Leaderboard capture gate reopened by read | §10 capture race |
| Session orphan OPEN rows | §4 orphan check + §5 interrupted |
| Admin JWT hook / concurrent retry / asyncpg bind | §9 role gate |
| E2E/Supabase CI setup footguns | §2 setup |
| Oracle value is label-only in `resultLabels.ts` (not emitted by any script) | §3/§5 — derive expected outcomes from the mock scripts |
