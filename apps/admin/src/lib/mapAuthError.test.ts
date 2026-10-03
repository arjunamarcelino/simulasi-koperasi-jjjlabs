import { describe, expect, it } from "vitest";
import type { AuthError } from "@supabase/supabase-js";
import { mapAuthError } from "./mapAuthError";

const err = (code?: string): AuthError =>
  ({ code, message: "m", name: "AuthApiError", status: 400 }) as unknown as AuthError;

describe("mapAuthError", () => {
  it("maps known codes", () => {
    expect(mapAuthError(err("invalid_credentials"))).toBe("invalid_credentials");
    expect(mapAuthError(err("email_not_confirmed"))).toBe("email_not_confirmed");
    expect(mapAuthError(err("over_request_rate_limit"))).toBe("rate_limited");
    expect(mapAuthError(err("over_email_send_rate_limit"))).toBe("rate_limited");
  });

  it("falls back to unknown for undefined or unrecognized codes", () => {
    expect(mapAuthError(err(undefined))).toBe("unknown");
    expect(mapAuthError(err("something_new"))).toBe("unknown");
  });
});
