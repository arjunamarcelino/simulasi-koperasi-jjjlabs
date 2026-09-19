# Data Model — Koperasi Simulator (SIM-2)

Bridge documentation for the project's first database. Two diagrams: **AS-IS** (what
`localStorage` holds today) and **TARGET** (the Supabase/Postgres schema in this
`@simkop/db` package), plus a gap/mapping table. Rationale and decisions live in the
local plan (`docs/plans/2026-09-19-feat-supabase-data-model-schema-plan.md`, kept out of
git per repo convention); this file is the tracked reference.

- **Engine:** Supabase Postgres. **Write path:** `apps/web` direct via `supabase-js`,
  guarded by RLS. The voice backend (`apps/backend`) stays database-free.
- **Identity:** `public.profiles` is 1:1 with `auth.users` (guest via anonymous sign-in,
  or Google OAuth; a guest upgrades in place via `linkIdentity`, id preserved).
- **Level is derived** from XP (`level_from_xp()`), never stored.

## AS-IS — localStorage (today)

Anonymous, browser-local, lost across devices/clears. Keys under `koperasi.*`
(`apps/web/src/stores/game.store.ts`).

```mermaid
erDiagram
  PLAYER ||--o{ REDEEMED_VOUCHER : "koperasi.vouchers"
  PLAYER ||--o{ COMPLETED_MISSION : "koperasi.missions"
  PLAYER {
    string playerName "koperasi.playerName — no id, no auth"
    number xp "koperasi.xp"
    number point "koperasi.point"
  }
  REDEEMED_VOUCHER {
    string voucherId
    string name "denormalized"
    string code
    number redeemedAt "epoch ms"
  }
  COMPLETED_MISSION { string missionId }
```

The scenario result (`AuditorResult`) is produced server-side and shown at end of
session, but **never persisted** — it lives only in transient `sessionStore` state.
Level and badges are **derived** in the UI from live signals, also not stored.

## TARGET — Supabase schema

10 tables. Owner-only RLS on user-scoped tables; public read on `*_definition` catalogs
(except `mission_definition`, whose reallife `redeem_code` is kept out of clients behind the
`mission_catalog` view). Session score is folded into `sessions` (written at start,
finalized at end).

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "1:1 (managed by Supabase Auth)"
  PROFILES ||--|| USER_PROGRESS : has
  PROFILES ||--o{ SESSIONS : plays
  SCENARIO_DEFINITION ||--o{ SESSIONS : typed_by
  PROFILES ||--o{ MISSION_COMPLETION : claims
  MISSION_DEFINITION ||--o{ MISSION_COMPLETION : completed_in
  PROFILES ||--o{ VOUCHER_REDEMPTION : redeems
  VOUCHER_DEFINITION ||--o{ VOUCHER_REDEMPTION : redeemed_as
  PROFILES ||--o{ USER_BADGE : earns
  BADGE_DEFINITION ||--o{ USER_BADGE : awarded_as

  PROFILES {
    uuid id PK "→ auth.users.id"
    text display_name "≤16, nullable (← playerName)"
    timestamptz created_at
    timestamptz updated_at
  }
  USER_PROGRESS {
    uuid user_id PK "→ profiles.id"
    int xp "≥0 — level derived, not stored"
    int point "≥0"
  }
  SESSIONS {
    uuid id PK
    uuid user_id FK
    text scenario_id FK
    timestamptz started_at "written at session start"
    timestamptz ended_at "null until ended"
    text trigger "CHECK manual|sinyal_level_1|force_quit_level_2; null until ended"
    text ending_type "CHECK good|bad|neutral; null until scored"
    jsonb scores_json "per-scenario rubric, 0-100"
    jsonb state_json "AuditorResult.stateClassification"
    text narrative_feedback
  }
  SCENARIO_DEFINITION {
    text code PK
    text title
    text difficulty
    text status "CHECK AVAILABLE|COMING_SOON"
  }
  MISSION_DEFINITION {
    text code PK
    text kind "CHECK game|reallife"
    int reward_xp
    int reward_point
    text redeem_code "soft KDMP gate code; reallife only; REVOKEd from clients"
  }
  MISSION_COMPLETION {
    bigint id PK
    uuid user_id FK
    text mission_id FK
    timestamptz completed_at
  }
  VOUCHER_DEFINITION {
    text code PK
    text name
    int cost
  }
  VOUCHER_REDEMPTION {
    bigint id PK
    uuid user_id FK
    text voucher_id FK
    text voucher_name "denormalized"
    text minted_code UK
    int cost_point
  }
  BADGE_DEFINITION {
    text code PK
    text title
    text icon "CHECK (9 icon kinds)"
    jsonb criteria "mirrors BadgeCriteria; null = teaser"
  }
  USER_BADGE {
    bigint id PK
    uuid user_id FK
    text badge_id FK
    timestamptz awarded_at "the new fact"
  }
```

**Not tables:** `level_from_xp(int)` is an `IMMUTABLE` function (thresholds
`[0,100,300,600,1000,1500]`, 1-based). `leaderboard(limit)` is a `SECURITY DEFINER`
function that publishes a bounded `display_name + xp + level` projection (owner-only RLS
would otherwise hide other players).

**Server-side integrity RPCs** (`SECURITY DEFINER`, `search_path=''`, `REVOKE EXECUTE
FROM public`): `claim_mission` (validates the gate code server-side, credits reward atomically, idempotent
via `unique(user_id, mission_id)`), `redeem_voucher` (race-safe balance debit, mints a unique
code), `record_session_result` (finalizes an owned open session). `add_rewards` is a **private**
helper, never client-callable. Badges are awarded by a plain RLS-guarded insert (idempotent via
`unique(user_id, badge_id)`); the earn rule stays client-side (cosmetic, client-trusted).

## Gap / mapping

| AS-IS (localStorage) | TARGET | Notes |
|---|---|---|
| `koperasi.playerName` | `profiles.display_name` | **net-new** identity/id + auth (guest or Google) |
| `koperasi.xp` / `koperasi.point` | `user_progress.xp` / `.point` | 1:1 satellite; level derived |
| `koperasi.vouchers[]` | `voucher_redemption` | repeatable; `voucher_name` kept denormalized |
| `koperasi.missions[]` | `mission_completion` | `unique(user_id, mission_id)`; server-side `redeem_code` for reallife |
| (derived in UI) level | `level_from_xp()` | never a column |
| (derived in UI) badges | `badge_definition` + `user_badge.awarded_at` | **persisted**; `awarded_at` is the new fact |
| (transient) `AuditorResult` | `sessions` (folded score columns) | transcript **not** persisted; row written at session start |
| FE static content arrays | `*_definition` tables | seeded from `apps/db/catalog/*.json` (shared source, CI parity-checked) |

### Net-new (nothing persists these today)
Identity/auth, `sessions` + score, `user_badge.awarded_at`, and the four `*_definition`
catalog tables (formerly FE-only arrays; the DB is now the source of truth, with the FE
and the seed both deriving from the shared `@simkop/catalog` package).

> **On the reallife codes:** `redeem_code` (`KDMP2026` etc.) is a *soft* gate — printed at
> the KDMP and typed by the player. It is **not** a cryptographic secret. The DB hides it
> (REVOKE + `mission_catalog` view) as defense-in-depth only; the same codes still ship in
> the client bundle today (see follow-up). Treat gate-code claims as best-effort, not anti-cheat.

## Follow-ups (out of scope for SIM-2 BE)
- FE integration: `supabase-js` client, guest + Google auth (`linkIdentity`), writing the
  session row at start + `record_session_result` at end, reading catalogs from the DB.
- **Stop shipping reallife codes in the client bundle** (they are still in `@simkop/catalog`,
  which the FE imports). If they must be non-guessable, mint high-entropy codes into an
  untracked source and enter them only via the KDMP, never bundle them.
- Enable Auth settings in the Supabase project: anonymous sign-ins, manual linking, Google
  provider, CAPTCHA/rate-limit on anonymous sign-in.
- `pg_cron` cleanup of stale anonymous users.
