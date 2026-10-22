/**
 * Shared narrowing primitives for the repo contract parsers. postgREST hands back an
 * unvalidated `Json`, so every contract narrows it at the boundary with these guards
 * (no zod). Extracted here once both progressRepo and sessionsRepo needed them.
 */
export const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

export const num = (u: unknown): number | null =>
  typeof u === "number" && Number.isFinite(u) ? u : null;

export const str = (u: unknown): string | null => (typeof u === "string" ? u : null);

export const strArray = (u: unknown): string[] | null =>
  Array.isArray(u) && u.every((x) => typeof x === "string") ? (u as string[]) : null;
