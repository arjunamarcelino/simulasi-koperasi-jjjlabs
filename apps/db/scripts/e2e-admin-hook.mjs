// End-to-end proof of the custom access token hook through a REAL GoTrue sign-in.
// This is the one path pgTAP cannot exercise: the hook reads public.admins as
// `supabase_auth_admin` (which does NOT bypass RLS), but the pgTAP session user cannot
// `SET ROLE supabase_auth_admin` (Supabase's local `postgres` is not a true superuser →
// "permission denied to set role"). So a broken `auth_admin_reads_admins` RLS policy or
// a missing grant would silently lock out every admin with green pgTAP — only a real
// sign-in catches it. Run against a local `supabase start` (the stack GoTrue, which
// honors config.toml's [auth.hook.custom_access_token]).
//
// Env: SUPABASE_URL (API), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { Buffer } from "node:buffer";

const API = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!API || !ANON || !SERVICE) {
  console.error("e2e-admin-hook: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const email = `admin-e2e-${Date.now()}@sim14.local`;
const password = "e2e-admin-pw-123456";

const svcHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const anonHeaders = { apikey: ANON, "Content-Type": "application/json" };

function claimsOf(jwt) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let userId;
try {
  // 1) Provision an admin via the service_role admin API (signup-off doesn't block it).
  let res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const created = await res.json().catch(() => ({}));
  assert(res.status === 200 && created.id, `createUser (${res.status}): ${JSON.stringify(created)}`);
  userId = created.id;

  // 2) Promote: insert into public.admins via PostgREST (service_role bypasses RLS).
  res = await fetch(`${API}/rest/v1/admins`, {
    method: "POST",
    headers: { ...svcHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId }),
  });
  assert(res.status === 201 || res.status === 200, `insert admins (${res.status}): ${await res.text()}`);

  // 3) Password sign-in → the hook (reading admins as supabase_auth_admin via the RLS
  //    policy) must stamp is_admin:true. This is the RLS-read path pgTAP can't cover.
  res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: anonHeaders,
    body: JSON.stringify({ email, password }),
  });
  const login = await res.json().catch(() => ({}));
  assert(res.status === 200 && login.access_token, `password login (${res.status}): ${JSON.stringify(login)}`);
  const admin = claimsOf(login.access_token);
  assert(admin.is_admin === true, `admin JWT is_admin !== true: ${JSON.stringify(admin)}`);
  assert(admin.is_anonymous === false, `admin JWT is_anonymous !== false: ${JSON.stringify(admin)}`);

  // 4) Anonymous guest → is_admin:false (hook runs for every token; game unaffected).
  res = await fetch(`${API}/auth/v1/signup`, { method: "POST", headers: anonHeaders, body: JSON.stringify({}) });
  const guest = await res.json().catch(() => ({}));
  assert(res.status === 200 && guest.access_token, `anon signup (${res.status}): ${JSON.stringify(guest)}`);
  const guestClaims = claimsOf(guest.access_token);
  assert(guestClaims.is_admin === false, `guest JWT is_admin !== false: ${JSON.stringify(guestClaims)}`);

  console.log("e2e-admin-hook: PASS (admin is_admin:true, guest is_admin:false)");
} catch (err) {
  console.error(`e2e-admin-hook: FAIL — ${err.message}`);
  process.exitCode = 1;
} finally {
  // Clean up the test admin (cascades the admins row via the FK).
  if (userId) {
    await fetch(`${API}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svcHeaders }).catch(() => {});
  }
}
