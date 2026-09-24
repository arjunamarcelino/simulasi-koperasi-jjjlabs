/**
 * Shared result contract for the Supabase repo adapters. Every adapter method returns
 * a discriminated RepoResult so callers handle each outcome at compile time — crucially,
 * `degraded` (no client / offline) is data, not an exception, so it never collapses into
 * an rpc-error path.
 *
 * Lives in its own module so multiple adapters (progressRepo, sessionsRepo, …) can share
 * it without depending on one another.
 */
export type RepoResult<T> =
  | { status: "ok"; data: T }
  | { status: "degraded" } // supabase === null → keep local, do NOT roll back
  | { status: "rpcError"; error: unknown } // RPC/query failed → roll back the optimistic delta
  | { status: "invalid"; raw: unknown }; // returned an unexpected shape

/** Fold a postgREST `{ data, error }` pair through a parser into a RepoResult. */
export function settle<T>(
  data: unknown,
  error: unknown,
  parse: (u: unknown) => T | null,
): RepoResult<T> {
  if (error) return { status: "rpcError", error };
  const parsed = parse(data);
  return parsed ? { status: "ok", data: parsed } : { status: "invalid", raw: data };
}
