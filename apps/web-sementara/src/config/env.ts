export type TransportKind = "mock" | "livekit";

function readTransport(): TransportKind {
  return import.meta.env.VITE_TRANSPORT === "livekit" ? "livekit" : "mock";
}

/**
 * Tanpa .env sama sekali, harness ini harus tetap jalan. Karena itu "mock"
 * adalah default, bukan sekadar salah satu pilihan.
 */
export const ENV = {
  transport: readTransport(),
  tokenEndpoint: import.meta.env.VITE_TOKEN_ENDPOINT ?? "",
} as const;
