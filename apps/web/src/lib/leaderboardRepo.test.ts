import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal adapter smoke test, mirroring sessionsRepo.test.ts. The parser matrix lives
// in progressRepo.contracts.test.ts; here we only assert the RepoResult mapping for the
// leaderboard_current RPC.

type RpcResult = { data: unknown; error: unknown };

/** Fake the postgREST client: rpc("leaderboard_current") → Promise<RpcResult>. */
function fakeSupabase(result: RpcResult) {
  return { rpc: () => Promise.resolve(result) };
}

async function loadRepo(supabase: unknown) {
  vi.resetModules();
  vi.doMock("./supabase", () => ({ supabase }));
  return (await import("./leaderboardRepo")).leaderboardRepo;
}

afterEach(() => {
  vi.doUnmock("./supabase");
  vi.resetModules();
});

describe("leaderboardRepo.current", () => {
  it("is degraded when there is no supabase client", async () => {
    const repo = await loadRepo(null);
    expect(await repo.current()).toEqual({ status: "degraded" });
  });

  it("maps an rpc error to rpcError", async () => {
    const repo = await loadRepo(fakeSupabase({ data: null, error: { message: "boom" } }));
    expect((await repo.current()).status).toBe("rpcError");
  });

  it("maps a non-array payload to invalid", async () => {
    const repo = await loadRepo(fakeSupabase({ data: { nope: true }, error: null }));
    expect((await repo.current()).status).toBe("invalid");
  });

  it("maps a malformed row to invalid", async () => {
    const repo = await loadRepo(
      fakeSupabase({ data: [{ display_name: "Budi", xp: 10, level: 2 }], error: null }), // missing rank
    );
    expect((await repo.current()).status).toBe("invalid");
  });

  it("parses a valid array into ok (and ignores an echoed user_id)", async () => {
    const rows = [
      { display_name: "Budi", xp: 120, level: 3, rank: 1, user_id: "should-be-ignored" },
      { display_name: "Siti", xp: 80, level: 2, rank: 2 },
    ];
    const repo = await loadRepo(fakeSupabase({ data: rows, error: null }));
    const res = await repo.current();
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data).toEqual([
        { display_name: "Budi", xp: 120, level: 3, rank: 1 },
        { display_name: "Siti", xp: 80, level: 2, rank: 2 },
      ]);
      // The contract never surfaces user_id.
      expect("user_id" in res.data[0]!).toBe(false);
    }
  });

  it("parses an empty array into ok (no season yet, distinct from degraded)", async () => {
    const repo = await loadRepo(fakeSupabase({ data: [], error: null }));
    expect(await repo.current()).toEqual({ status: "ok", data: [] });
  });
});
