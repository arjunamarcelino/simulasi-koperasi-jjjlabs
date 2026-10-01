import { afterEach, describe, expect, it, vi } from "vitest";

// Repo-boundary tests for the SIM-6 session-persistence methods. The supabase client
// is a hand-rolled stub (no jsdom, node env); the real parsers run so the discriminated
// RepoResult / RecordSessionOutcome mapping is exercised end to end.

type QueryResult = { data: unknown; error: unknown };

function makeClient(opts: {
  uid?: string | null;
  insert?: QueryResult;
  rpc?: QueryResult;
}) {
  return {
    auth: {
      getSession: async () => ({
        data: { session: opts.uid == null ? null : { user: { id: opts.uid } } },
      }),
    },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => opts.insert ?? { data: null, error: null },
        }),
      }),
    }),
    rpc: async () => opts.rpc ?? { data: null, error: null },
  };
}

async function loadRepo(client: unknown | null) {
  vi.resetModules();
  vi.doMock("./supabase", () => ({ supabase: client }));
  const mod = await import("./progressRepo");
  return mod.progressRepo;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./supabase");
});

describe("progressRepo.openSession", () => {
  it("degrades when there is no supabase client", async () => {
    const repo = await loadRepo(null);
    expect(await repo.openSession("kredit-macet")).toEqual({ status: "degraded" });
  });

  it("degrades when no user is signed in", async () => {
    const repo = await loadRepo(makeClient({ uid: null }));
    expect(await repo.openSession("kredit-macet")).toEqual({ status: "degraded" });
  });

  it("returns the inserted id on success", async () => {
    const repo = await loadRepo(
      makeClient({ uid: "u1", insert: { data: { id: "s1" }, error: null } }),
    );
    expect(await repo.openSession("kredit-macet")).toEqual({ status: "ok", data: { id: "s1" } });
  });

  it("maps an RLS/transport error to rpcError", async () => {
    const error = { code: "42501", message: "rls" };
    const repo = await loadRepo(makeClient({ uid: "u1", insert: { data: null, error } }));
    expect(await repo.openSession("kredit-macet")).toEqual({ status: "rpcError", error });
  });

  it("flags an unparseable row as invalid", async () => {
    const repo = await loadRepo(
      makeClient({ uid: "u1", insert: { data: { nope: 1 }, error: null } }),
    );
    expect(await repo.openSession("kredit-macet")).toEqual({ status: "invalid", raw: { nope: 1 } });
  });
});

const INPUT = {
  sessionId: "s1",
  trigger: "manual",
  endingType: "good",
  scores: {},
  state: {},
  feedback: "ok",
} as const;

describe("progressRepo.recordSessionResult", () => {
  it("degrades when there is no supabase client", async () => {
    const repo = await loadRepo(null);
    expect(await repo.recordSessionResult({ ...INPUT })).toEqual({ status: "degraded" });
  });

  it("returns the ok outcome on success", async () => {
    const repo = await loadRepo(
      makeClient({ uid: "u1", rpc: { data: { ok: true, session_id: "s1" }, error: null } }),
    );
    expect(await repo.recordSessionResult({ ...INPUT })).toEqual({
      status: "ok",
      data: { ok: true, sessionId: "s1" },
    });
  });

  it("surfaces a business failure as ok data (caller inspects reason)", async () => {
    const repo = await loadRepo(
      makeClient({
        uid: "u1",
        rpc: { data: { ok: false, reason: "not_found_or_closed" }, error: null },
      }),
    );
    expect(await repo.recordSessionResult({ ...INPUT })).toEqual({
      status: "ok",
      data: { ok: false, reason: "not_found_or_closed" },
    });
  });

  it("maps a raised RPC error to rpcError", async () => {
    const error = { message: "boom" };
    const repo = await loadRepo(makeClient({ uid: "u1", rpc: { data: null, error } }));
    expect(await repo.recordSessionResult({ ...INPUT })).toEqual({ status: "rpcError", error });
  });
});
