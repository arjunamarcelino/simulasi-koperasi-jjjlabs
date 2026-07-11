export type TransportKind = "mock" | "livekit";

function readTransport(): TransportKind {
  return import.meta.env.VITE_TRANSPORT === "livekit" ? "livekit" : "mock";
}

/**
 * Without any .env, this must still run. So "mock" is the default, not merely
 * one of the options. Set VITE_TRANSPORT=livekit + VITE_TOKEN_ENDPOINT to hit
 * the real backend.
 */
export const ENV = {
  transport: readTransport(),
  tokenEndpoint: import.meta.env.VITE_TOKEN_ENDPOINT ?? "",
} as const;
