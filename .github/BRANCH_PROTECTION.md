# CI & merge gates (branch protection)

PRs into `develop` and `main` are gated by three **required** status checks:

| Check (status context) | Workflow | Gates |
|---|---|---|
| `web` | `web-ci.yml` | typecheck + lint + test + build (+ e2e-seam guard) |
| `admin` | `admin-ci.yml` | typecheck + lint + test + build |
| `backend` | `backend-ci.yml` | ruff + pytest |

`e2e` and `db-tests` are **advisory** (they run and report, but do not block merge) because they
depend on a local Supabase/Docker stack and are Docker-Hub-flaky.

> **The required contexts are the job names (`web`/`admin`/`backend`), not the workflow names.**
> For a required check to work it must run on *every* PR — that is why `web-ci`/`admin-ci`/
> `backend-ci` have **no `paths:`/`paths-ignore:` filter**. A path-filtered required check never
> runs on an unrelated PR, and GitHub then pins it "Expected"/pending forever and blocks merge.

## Protection is repo settings, not a committed file

Branch protection lives in GitHub repo settings, so it does **not** appear in any PR diff and is
**lost on a repo transfer/fork**. Re-apply with the commands below (requires `gh` authenticated as
a repo **admin**; for this repo that is the `arjunamarcelino` account).

```bash
# Apply identical protection to develop and main.
for b in develop main; do
  gh api -X PUT "repos/arjunamarcelino/simulasi-koperasi-jjjlabs/branches/$b/protection" \
    --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["web", "admin", "backend"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
JSON
done
```

Field rationale:
- `contexts` — the three required job names.
- `strict: false` — do **not** require the branch to be up to date before merge (avoids rebase churn).
- `enforce_admins: false` — admins keep an escape hatch (force-merge a red/pending PR when needed);
  the gate binds non-admin/future contributors.
- `required_pull_request_reviews.required_approving_review_count: 0` — a PR is required, but no
  approving review is (so a solo maintainer isn't self-blocked).
- `restrictions: null` — no push-actor allowlist.

## Verify

```bash
# Show current protection (should list the three contexts).
gh api repos/arjunamarcelino/simulasi-koperasi-jjjlabs/branches/develop/protection \
  --jq '.required_status_checks.contexts'
```

Then open a throwaway PR that deliberately breaks a web test and confirm merge is blocked for a
non-admin (and that the three checks show, none stuck on "Expected").

## Remove (if ever needed)

```bash
gh api -X DELETE repos/arjunamarcelino/simulasi-koperasi-jjjlabs/branches/develop/protection
gh api -X DELETE repos/arjunamarcelino/simulasi-koperasi-jjjlabs/branches/main/protection
```
