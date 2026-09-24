import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal adapter smoke test. Intentionally small — the parser matrix
// (sessionsRepo.contracts.test.ts) carries the real coverage, and there is no
// progressRepo.test.ts precedent. We only assert the RepoResult mapping here.

type QueryResult = { data: unknown; error: unknown };

/** Fake the postgREST builder chain: from().select().not().order().limit() → Promise<QueryResult>. */
function fakeSupabase(result: QueryResult) {
  const builder = {
    select: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => Promise.resolve(result),
  };
  return { from: () => builder };
}

async function loadRepo(supabase: unknown) {
  vi.resetModules();
  vi.doMock("./supabase", () => ({ supabase }));
  return (await import("./sessionsRepo")).sessionsRepo;
}

afterEach(() => {
  vi.doUnmock("./supabase");
  vi.resetModules();
});

describe("sessionsRepo.listMySessions", () => {
  it("is degraded when there is no supabase client", async () => {
    const repo = await loadRepo(null);
    expect(await repo.listMySessions()).toEqual({ status: "degraded" });
  });

  it("maps a query error to rpcError", async () => {
    const repo = await loadRepo(fakeSupabase({ data: null, error: { message: "boom" } }));
    const res = await repo.listMySessions();
    expect(res.status).toBe("rpcError");
  });

  it("parses rows into ok on success", async () => {
    const row = {
      id: "s1",
      scenario_id: "kredit-macet",
      started_at: "2026-09-20T10:00:00.000Z",
      ended_at: "2026-09-20T10:12:00.000Z",
      trigger: "manual",
      ending_type: "good",
      scores_json: { compliance: 70 },
      state_json: {},
      narrative_feedback: null,
    };
    const repo = await loadRepo(fakeSupabase({ data: [row], error: null }));
    const res = await repo.listMySessions();
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.scenarioId).toBe("kredit-macet");
    }
  });
});
