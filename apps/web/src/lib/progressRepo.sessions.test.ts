import { afterEach, describe, expect, it, vi } from "vitest";

// Repo-boundary tests for the SIM-6 atomic record_session method. The supabase client is
// a hand-rolled stub that CAPTURES the rpc call, so the wire mapping (fn name + param
// names) is asserted; the real parser runs so the RepoResult / RecordSessionResult mapping
// is exercised end to end. Node env, no jsdom.

type QueryResult = { data: unknown; error: unknown };
type RpcCall = { fn: string; args: Record<string, unknown> };

function makeClient(rpc: QueryResult, calls: RpcCall[]) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return rpc;
    },
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

const INPUT = {
  scenarioId: "kredit-macet",
  trigger: "manual",
  endingType: "good",
  scores: { compliance: 80 },
  state: { foo: "BENAR" },
  feedback: "Bagus",
  startedAt: "2026-10-01T00:00:00.000Z",
} as const;

const NO_START = {
  scenarioId: "kredit-macet",
  trigger: "manual",
  endingType: "good",
  scores: {},
  state: {},
  feedback: "x",
} as const;

describe("progressRepo.recordSession", () => {
  it("degrades when there is no supabase client (no RPC call)", async () => {
    const calls: RpcCall[] = [];
    const repo = await loadRepo(null);
    expect(await repo.recordSession({ ...INPUT })).toEqual({ status: "degraded" });
    expect(calls).toHaveLength(0);
  });

  it("calls record_session with the mapped params and returns ok", async () => {
    const calls: RpcCall[] = [];
    const repo = await loadRepo(makeClient({ data: { ok: true, session_id: "s1" }, error: null }, calls));
    expect(await repo.recordSession({ ...INPUT })).toEqual({ status: "ok", data: { ok: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe("record_session");
    expect(calls[0]?.args).toEqual({
      p_scenario_id: "kredit-macet",
      p_trigger: "manual",
      p_ending_type: "good",
      p_scores: { compliance: 80 },
      p_state: { foo: "BENAR" },
      p_feedback: "Bagus",
      p_started_at: "2026-10-01T00:00:00.000Z",
    });
  });

  it("passes p_started_at null when startedAt is omitted", async () => {
    const calls: RpcCall[] = [];
    const repo = await loadRepo(makeClient({ data: { ok: true }, error: null }, calls));
    await repo.recordSession({ ...NO_START });
    expect(calls[0]?.args["p_started_at"]).toBeNull();
  });

  it("surfaces a business failure as ok data (caller inspects reason)", async () => {
    const calls: RpcCall[] = [];
    const repo = await loadRepo(makeClient({ data: { ok: false, reason: "too_large" }, error: null }, calls));
    expect(await repo.recordSession({ ...INPUT })).toEqual({
      status: "ok",
      data: { ok: false, reason: "too_large" },
    });
  });

  it("maps a raised RPC error to rpcError", async () => {
    const calls: RpcCall[] = [];
    const error = { message: "boom" };
    const repo = await loadRepo(makeClient({ data: null, error }, calls));
    expect(await repo.recordSession({ ...INPUT })).toEqual({ status: "rpcError", error });
  });

  it("flags an unparseable payload as invalid", async () => {
    const calls: RpcCall[] = [];
    const repo = await loadRepo(makeClient({ data: { ok: false, reason: "weird" }, error: null }, calls));
    expect(await repo.recordSession({ ...INPUT })).toEqual({
      status: "invalid",
      raw: { ok: false, reason: "weird" },
    });
  });
});
