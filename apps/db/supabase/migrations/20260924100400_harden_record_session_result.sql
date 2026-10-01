-- Harden record_session_result: revoke EXECUTE from anon.
-- The original grant (20260919092000_gameplay.sql) only revoked from `public`, which
-- leaves anon's default-privilege grant intact (the SIM-5 anon trap). Anonymous
-- *guests* run as the `authenticated` role (they carry a JWT); the `anon` role is the
-- no-JWT case and must never reach this write RPC. A revoke is idempotent + reversible.
revoke execute on function public.record_session_result(uuid, text, text, jsonb, jsonb, text) from anon;
