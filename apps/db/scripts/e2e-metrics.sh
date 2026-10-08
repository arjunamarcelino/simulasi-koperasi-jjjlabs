#!/usr/bin/env bash
# End-to-end proof that the REAL least-privilege `metrics_reader` login role can EXECUTE
# admin.metrics_overview() but CANNOT read the underlying tables. pgTAP can't cover this:
# it asserts the grant matrix via has_*_privilege but does not connect AS the role (and
# SET ROLE into a non-member login role is unreliable), so a broken grant/ownership or a
# wrong password would ship green. This connects with the role's own credentials.
#
# Requires the role's password to be set first (it's NULL in the migration) — see db-tests.yml.
# METRICS_DB_URL defaults to the local `supabase start` DB as metrics_reader.
set -euo pipefail

DSN="${METRICS_DB_URL:-postgresql://metrics_reader:postgres@127.0.0.1:54322/postgres}"

# 1) EXECUTE works and returns a well-formed JSON object.
out="$(psql "$DSN" -tAc "select jsonb_typeof(admin.metrics_overview())" 2>&1)" || {
  echo "e2e-metrics: FAIL — metrics_reader cannot execute admin.metrics_overview(): $out"
  exit 1
}
echo "$out" | grep -q '^object$' || {
  echo "e2e-metrics: FAIL — metrics_overview() did not return an object: $out"
  exit 1
}

# 2) Direct table reads are DENIED (least privilege: EXECUTE-only, no table grants).
if psql "$DSN" -tAc "select 1 from public.sessions limit 1" >/dev/null 2>&1; then
  echo "e2e-metrics: FAIL — metrics_reader can read public.sessions directly (should be denied)"
  exit 1
fi

echo "e2e-metrics: PASS (metrics_reader executes the function; direct table read denied)"
