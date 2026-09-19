# @simkop/db — Koperasi Simulator data model (SIM-2)

Supabase/Postgres schema, seed, and pgTAP tests. The rest of the monorepo backend
(`apps/backend`) stays database-free; `apps/web` is the only runtime consumer of
this database (web-direct via `supabase-js`, guarded by RLS).

Design doc (ERDs + gap table): [`DATA-MODEL.md`](./DATA-MODEL.md).
Plan + brainstorm live under `docs/` (kept out of git per repo convention).

## Layout

```
catalog/*.json          # single source of truth for catalog content (FE + seed derive from these)
scripts/gen-seed.mjs    # catalog JSON → supabase/seed.sql (and --check parity guard)
supabase/
  config.toml
  migrations/           # dependency-ordered by timestamp (foundation < progress < gameplay < economy < achievements)
  seed.sql              # GENERATED — do not edit by hand
  tests/                # pgTAP: schema-smoke, rls-isolation, rpc-behavior
```

## Common commands

```bash
# Regenerate the seed after editing catalog/*.json
pnpm --filter @simkop/db gen:seed

# Fails if seed.sql is stale vs the catalog (also run in CI)
pnpm --filter @simkop/db check:parity

# Requires Supabase CLI + Docker running:
supabase start                     # bring up the local stack
pnpm --filter @simkop/db db:reset  # apply migrations + seed
pnpm --filter @simkop/db db:test   # run pgTAP tests
```

CI runs the reset + tests on every push (see `.github/workflows/db-tests.yml`), so
Docker is not required locally to land a change — but is needed to run the DB tests yourself.

## Key invariants (see the plan for rationale)

- **RLS is the security boundary.** Every `public` table has RLS enabled; user-scoped
  tables are owner-only (`(select auth.uid()) = user_id`) with `WITH CHECK` on writes.
- **Reallife gate codes are kept out of the DB's client surface** (defense-in-depth):
  `mission_definition` is revoked from `anon`/`authenticated`; the public `mission_catalog`
  view omits `redeem_code`. Note these are *soft* KDMP gate codes, not cryptographic secrets
  (and are still shipped in the client bundle today — see DATA-MODEL.md follow-ups).
- **Server-side integrity via `SECURITY DEFINER` RPCs** (`search_path=''`, `REVOKE EXECUTE
  FROM public`): `claim_mission`, `redeem_voucher`, `record_session_result`, `leaderboard`.
  `add_rewards` is a private helper (never client-callable).
- **Level is derived, never stored** (`level_from_xp`). One-time claims are idempotent via
  `UNIQUE(user_id, …)` + `ON CONFLICT DO NOTHING`.
