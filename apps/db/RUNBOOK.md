# Supabase Provisioning Runbook (SIM-1)

How to stand up the hosted Supabase environment `apps/db` targets, wire CI to deploy it,
and keep it alive for the 16-Oct demo. Repo automation (workflows, guards, `.env.example`)
already exists; **this runbook is the manual/ops half** (dashboard + secrets) plus verification.

> **Ignition rule:** the repo variable **`SUPABASE_ENABLED=true` is set LAST**, only after the
> project exists and every secret/var below is saved. Until then the CI workflows are dormant.

Design + rationale: `docs/plans/2026-09-20-chore-provision-supabase-env-plan.md`. Schema: [`DATA-MODEL.md`](./DATA-MODEL.md).

---

## 1. Create the project

1. Create a **Supabase organization** ("Simulasi Koperasi") — a team org, not a personal account (survives handover).
2. New **project**: region **Singapore (ap-southeast-1)**, Postgres **15**. Save the **DB password**.
3. Create a **dedicated CI bot account** (e.g. `simkop-ci`), add it to the org, and mint its
   **Personal Access Token** (Account → Access Tokens). Use the **bot's** token in CI — never a
   personal one (a PAT can delete any project in the org; keep the blast radius small).

## 2. Auth configuration (dashboard)

- **Providers → enable Anonymous sign-ins.**
- **Enable Manual identity linking** (guest → Google upgrade).
- **Google** provider:
  1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** (Web).
  2. Authorized **redirect URI**: `https://<ref>.supabase.co/auth/v1/callback` (+ `http://127.0.0.1:54321/auth/v1/callback` for local).
  3. Authorized **JavaScript origins**: the app origin(s) (e.g. the deployed FE URL + `http://localhost:5173`).
  4. Paste **Client ID + Secret** into Supabase → Auth → Providers → Google → enable.
- **URL Configuration**: set **Site URL** + add the FE origin(s) to the **redirect allow-list**.
- **Attack Protection → enable CAPTCHA → Cloudflare Turnstile** (paste the Turnstile secret key). Keep the anon-signin rate limit.
- **JWT Signing Keys**: ensure **asymmetric (ES256)** keys are active (migrate off legacy HS256 if needed). Note the **JWKS URL**: `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`.

## 3. GitHub secrets, variables, and Environment

Create a **GitHub Environment** named **`supabase-deploy`** (repo Settings → Environments) with a
**required reviewer** + restrict to the `develop` branch. Put the deploy-only secrets there:

| Name | Kind | Where | Value |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Environment secret | `supabase-deploy` | the **bot** account's PAT |
| `SUPABASE_DB_PASSWORD` | Environment secret | `supabase-deploy` | project DB password |
| `SUPABASE_PROJECT_ID` | repo secret | repo | project ref (the `<ref>` in the URL) |
| `SUPABASE_ANON_KEY` | repo secret | repo | anon/publishable key (public; masking is harmless) |
| `SUPABASE_DB_HOST` | repo **variable** | repo | **session pooler** host, e.g. `aws-0-ap-southeast-1.pooler.supabase.com` — copy from Settings → Database → Connection string → **Session pooler (5432)** |
| `SUPABASE_ENABLED` | repo **variable** | repo | `true` — **set LAST** |

Also give the FE its public env (`apps/web/.env` / hosting env): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

> **Never** store the `service_role` key anywhere in the repo/CI/FE. The `guard-secrets` workflow +
> GitHub **secret scanning + push protection** (already **enabled** on the repo) are the backstop that
> catches an actual key *blob* (`eyJ…` / `sb_secret_…`) that the `guard-secrets` name/value grep can't.

## 4. Keep-alive ⚠️ default-branch requirement

Free-tier projects **pause after ~7 days idle** → the demo dies if idle. `supabase-keepalive.yml`
pings daily. GitHub runs `schedule:` only from the workflow file on the repo's **DEFAULT branch** —
the default is now **`develop`** (done via `gh repo edit --default-branch develop`), so the cron fires
once this workflow merges to `develop`. ⚠️ If the default is ever moved back to `main`, move
`supabase-keepalive.yml` with it or the cron stops.

Belt-and-suspenders: add an **external monitor** (UptimeRobot / cron-job.org) hitting
`https://<ref>.supabase.co/rest/v1/` with the anon key daily — GitHub cron is best-effort, and a run
that never fires raises no alert. Put **calendar reminders on 14-Oct and 15-Oct** to open the
dashboard and confirm the project is **Active (not Paused)**. Escalate to **Pro** for the demo week if
you want the pause risk gone entirely.

## 5. First deploy (Go/No-Go)

**Pre-deploy** — all boxes before flipping `SUPABASE_ENABLED`:
- [ ] All secrets/vars above saved; `SUPABASE_DB_HOST` is the **session pooler (5432)**.
- [ ] ES256 keys active; JWKS URL noted.
- [ ] `guard-secrets` green on the branch (no `service_role` in FE/repo).
- [ ] **`SUPABASE_ENABLED=true` set LAST.**

**Deploy** — run `db-deploy` via **workflow_dispatch** (watched first run, not an unattended merge):
- [ ] Job **ran** (not skipped — a skip means `SUPABASE_ENABLED` isn't set).
- [ ] `supabase db push` reported migrations applied (**not** "no changes" on a fresh project).
- [ ] Seed step exit 0.
- [ ] **Smoke checks green** (`supabase/smoke/run.sh`: 10-table set, seed counts 4/7/5/9, `mission_definition` denied, `add_rewards` denied, JWKS ES256).

**Manual auth-flow verification** (can't run in CI once Turnstile is on — do from the app/SDK, or temporarily disable CAPTCHA to test):
- [ ] Anonymous sign-in returns a JWT with `is_anonymous: true`.
- [ ] The signup trigger provisioned rows: `select count(*) from profiles` ≥ 1 **and** every profile has a `user_progress` row (1:1).
- [ ] Two anonymous sessions each see **only their own** `user_progress` row (cross-tenant RLS).
- [ ] `GET /auth/v1/authorize?provider=google` → 302 to accounts.google.com.

## 6. Hand-off
- **SIM-3**: give the FE `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- **SIM-4**: give the **JWKS URL**. The backend must verify with `algorithms=["ES256"]` only (never let the token's `alg` pick the path), validate `iss` (`https://<ref>.supabase.co/auth/v1`), `aud=authenticated`, `exp`, and reject `is_anonymous:true` for reward/permanent gating; bound the JWKS client cache. Time-box + **retire the legacy HS256 secret** once ES256 is live. Adding the `Authorization` header makes `/token` **CORS-preflighted** → allow it in `apps/backend` CORS.

## 7. Rollback / recovery
- **Bad migration/seed, pre-cutover (greenfield):** `supabase db reset --linked` (⚠️ **destroys all hosted data**, replays migrations) → `psql -f supabase/seed.sql` to reseed. Set a **hard cutover date** after which this is forbidden.
- **Bad seed only:** fix `seed.sql`, re-run `psql -f` (idempotent; never deletes).
- **Post-cutover / real data:** forward corrective migration (never edit an applied one) — Free tier has **no PITR**; go **Pro** for the demo window if the data is unlosable.
- **Code rollback** is independent: revert the commit; the DB doesn't roll back with code.

## 8. Post-handover hygiene (optional — NOT needed for the 26-day hackathon)
Stale anonymous-user cleanup — **defer**: anon users can't reach 30 days old within the hackathon.
When it's eventually wanted (a `pg_cron` job deleting 30-day-old `is_anonymous` users), it's delicate
because manual identity-linking means a *converted* user must be excluded — so **dry-run the DELETE as a
SELECT and confirm zero linked users are caught before scheduling anything**. Write it up only if the
project outlives the hackathon. Cascade if you do run it: `auth.users` → `profiles` → user rows
(`on delete cascade`); `voucher_redemption` survives as an anonymized tombstone (`on delete set null`).

## 9. After the demo
- **Rotate/revoke** the CI bot's `SUPABASE_ACCESS_TOKEN`.
- Decide dev vs prod project separation if the project outlives the hackathon.
