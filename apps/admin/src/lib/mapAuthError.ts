import type { AuthError } from "@supabase/supabase-js";

/** Distinct login failure kinds the LoginForm renders different copy for. */
export type LoginErrorKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "unknown";

/**
 * Map a Supabase AuthError to a typed kind by `error.code` (NOT message substrings —
 * codes are stable, messages are not). `error.code` is `string | undefined`; the
 * default arm covers undefined and anything unrecognized.
 */
export function mapAuthError(error: AuthError): LoginErrorKind {
  switch (error.code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rate_limited";
    default:
      return "unknown";
  }
}
