#!/usr/bin/env bash
# Post-deploy smoke checks for the hosted Supabase project (run by db-deploy.yml).
# Covers the DB / REST / grant layer, which needs no user auth — so it runs
# unattended even with Turnstile CAPTCHA enabled. The auth-FLOW checks (anon
# sign-in issues a JWT, the signup trigger provisions profiles+user_progress,
# two-session RLS isolation) need a CAPTCHA token / the SDK and are MANUAL runbook
# ticks — see apps/db/RUNBOOK.md.
#
# Requires env: REF, ANON, and the PG* libpq vars (host/port/user/db/password/sslmode).
set -euo pipefail

BASE="https://${REF:?REF unset}.supabase.co"
ANON="${ANON:?ANON unset}"
rest() { curl -fsS "$BASE/rest/v1/$1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
fail() { echo "::error::smoke: $*"; exit 1; }

# Preflight: setup-cli provides `supabase`, not psql/jq — assert them up front so a
# missing tool fails loudly here instead of mid-check with a confusing error.
for tool in psql jq curl; do
  command -v "$tool" >/dev/null || fail "required tool '$tool' not on PATH"
done

echo "P1 — exactly the 10 SIM-2 base tables (view excluded)"
got=$(psql -tA -v ON_ERROR_STOP=1 -c \
  "select string_agg(table_name, ',' order by table_name) \
   from information_schema.tables \
   where table_schema='public' and table_type='BASE TABLE'")
want="badge_definition,mission_completion,mission_definition,profiles,scenario_definition,sessions,user_badge,user_progress,voucher_definition,voucher_redemption"
[ "$got" = "$want" ] || fail "base-table set mismatch: got [$got]"

echo "P2 — seed counts via anon REST (public-read catalogs + seed applied)"
[ "$(rest 'scenario_definition?select=code' | jq 'length')" = "4" ] || fail "scenario_definition != 4"
[ "$(rest 'mission_catalog?select=code'     | jq 'length')" = "7" ] || fail "mission_catalog != 7"
[ "$(rest 'voucher_definition?select=code'  | jq 'length')" = "5" ] || fail "voucher_definition != 5"
[ "$(rest 'badge_definition?select=code'    | jq 'length')" = "9" ] || fail "badge_definition != 9"

echo "N2 — mission_definition base table is NOT client-readable (secret redeem_code hidden)"
code=$(status "$BASE/rest/v1/mission_definition?select=redeem_code" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
[ "$code" -ge 400 ] || fail "mission_definition base readable by anon (HTTP $code) — REVOKE missing"

echo "N3 — add_rewards RPC exists AND is NOT callable by anon (the xp/point printer stays private)"
# Positive existence check FIRST: a plain '>=400' can't tell REVOKE (401/403) from a
# function that failed to deploy or drifted its signature (404) — that would false-pass
# as 'denied' while the reward path is actually broken. Prove it exists, then prove it's denied.
exists=$(psql -tA -v ON_ERROR_STOP=1 -c \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace \
   where n.nspname='public' and p.proname='add_rewards'")
[ "$exists" -ge 1 ] || fail "add_rewards is missing from schema public — the reward RPC failed to deploy"
code=$(status -X POST "$BASE/rest/v1/rpc/add_rewards" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"p_xp":1,"p_point":1}')
case "$code" in
  401 | 403) : ;; # denied — REVOKE EXECUTE FROM public is in force
  *) fail "add_rewards anon POST expected 401/403 (denied), got HTTP $code" ;;
esac

echo "P4 — JWKS advertises an ES256 signing key (for SIM-4 verification)"
curl -fsS "$BASE/auth/v1/.well-known/jwks.json" \
  | jq -e '.keys | map(.alg) | index("ES256")' >/dev/null \
  || fail "JWKS has no ES256 key — enable asymmetric (ES256) signing keys in the dashboard"

echo "smoke: all checks passed ✓"
