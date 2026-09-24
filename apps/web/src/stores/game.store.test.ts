import { afterEach, describe, expect, it, vi } from "vitest";

/** Memory-backed Storage stub, optionally pre-seeded. */
function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

type RepoResult<T> =
  | { status: "ok"; data: T }
  | { status: "degraded" }
  | { status: "rpcError"; error: unknown }
  | { status: "invalid"; raw: unknown };

const ok = <T>(data: T): RepoResult<T> => ({ status: "ok", data });

type RepoMock = {
  getMyProgress: ReturnType<typeof vi.fn>;
  fetchQuiz: ReturnType<typeof vi.fn>;
  claimMission: ReturnType<typeof vi.fn>;
  redeemVoucher: ReturnType<typeof vi.fn>;
  submitQuiz: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
  syncBadges: ReturnType<typeof vi.fn>;
};

/** Import a fresh game.store with a stubbed localStorage, a mocked supabase (online
 * flag), and a controllable progressRepo. */
async function loadStore(opts: {
  seed?: Record<string, string>;
  online?: boolean;
  repo?: Partial<RepoMock>;
}) {
  vi.resetModules();
  const storage = memStorage(opts.seed ?? {});
  vi.stubGlobal("window", { localStorage: storage });
  vi.doMock("../lib/supabase", () => ({ supabase: opts.online ? {} : null }));
  const repo: RepoMock = {
    getMyProgress: vi.fn().mockResolvedValue(ok({ xp: 0, point: 0, missions: [], vouchers: [], badges: [] })),
    fetchQuiz: vi.fn().mockResolvedValue(ok([])),
    claimMission: vi.fn(),
    redeemVoucher: vi.fn(),
    submitQuiz: vi.fn(),
    reconcile: vi.fn(),
    syncBadges: vi.fn().mockResolvedValue(ok(null)),
    ...opts.repo,
  };
  vi.doMock("../lib/progressRepo", () => ({ progressRepo: repo }));
  const mod = await import("./game.store");
  return { gameStore: mod.gameStore, storage, repo };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../lib/supabase");
  vi.doUnmock("../lib/progressRepo");
  vi.resetModules();
});

describe("game.store — degraded (no server)", () => {
  it("loads the device-local (legacy) wallet on owner change", async () => {
    const { gameStore } = await loadStore({
      online: false,
      seed: { "koperasi.xp": "120", "koperasi.point": "40" },
    });
    gameStore.getState().onOwnerChanged(null);
    expect(gameStore.getState().xp).toBe(120);
    expect(gameStore.getState().point).toBe(40);
    expect(gameStore.getState().hydrated).toBe(true);
  });

  it("completeMission credits a game mission locally", async () => {
    const { gameStore } = await loadStore({ online: false });
    gameStore.getState().onOwnerChanged(null);
    const res = await gameStore.getState().completeMission("baca-mading");
    expect(res.ok).toBe(true);
    expect(gameStore.getState().completedMissionIds).toContain("baca-mading");
    expect(gameStore.getState().xp).toBeGreaterThan(0);
  });

  it("submitQuiz is unavailable offline", async () => {
    const { gameStore } = await loadStore({ online: false });
    gameStore.getState().onOwnerChanged(null);
    const res = await gameStore.getState().submitQuiz([{ code: "q01", choice: 0 }]);
    expect(res).toEqual({ ok: false, reason: "degraded" });
  });
});

describe("game.store — online (server-authoritative)", () => {
  it("hydrates the wallet from the DB on owner change", async () => {
    const { gameStore } = await loadStore({
      online: true,
      repo: {
        getMyProgress: vi
          .fn()
          .mockResolvedValue(ok({ xp: 50, point: 30, missions: ["keliling"], vouchers: [], badges: [] })),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().hydrated).toBe(true));
    expect(gameStore.getState().xp).toBe(50);
    expect(gameStore.getState().completedMissionIds).toEqual(["keliling"]);
  });

  it("completeMission reconciles authoritative totals from the RPC", async () => {
    const { gameStore } = await loadStore({
      online: true,
      repo: {
        claimMission: vi
          .fn()
          .mockResolvedValue(ok({ ok: true, reward: { xp: 15, point: 10 }, totals: { xp: 999, point: 888 } })),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().hydrated).toBe(true));
    await gameStore.getState().completeMission("baca-mading");
    expect(gameStore.getState().xp).toBe(999); // server totals win over the optimistic delta
    expect(gameStore.getState().point).toBe(888);
    expect(gameStore.getState().completedMissionIds).toContain("baca-mading");
  });

  it("completeMission rolls back the optimistic delta on RPC error", async () => {
    const { gameStore } = await loadStore({
      online: true,
      repo: { claimMission: vi.fn().mockResolvedValue({ status: "rpcError", error: new Error("boom") }) },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().hydrated).toBe(true));
    const res = await gameStore.getState().completeMission("baca-mading");
    expect(res.ok).toBe(false);
    expect(gameStore.getState().xp).toBe(0); // rolled back
    expect(gameStore.getState().completedMissionIds).not.toContain("baca-mading");
  });

  it("redeemVoucher applies the authoritative balance + server code", async () => {
    const { gameStore } = await loadStore({
      online: true,
      repo: {
        getMyProgress: vi
          .fn()
          .mockResolvedValue(ok({ xp: 0, point: 100, missions: [], vouchers: [], badges: [] })),
        redeemVoucher: vi.fn().mockResolvedValue(ok({ ok: true, code: "KDMP-SERVER01", balance: 50 })),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().point).toBe(100));
    const voucher = await gameStore.getState().redeemVoucher("belanja-5k");
    expect(voucher?.code).toBe("KDMP-SERVER01");
    expect(gameStore.getState().point).toBe(50);
    expect(gameStore.getState().redeemedVouchers.at(-1)?.code).toBe("KDMP-SERVER01");
  });

  it("runs the one-time legacy migration then deletes the legacy keys", async () => {
    const { gameStore, storage } = await loadStore({
      online: true,
      seed: { "koperasi.xp": "100", "koperasi.point": "20", "koperasi.missions": '["keliling"]' },
      repo: {
        getMyProgress: vi
          .fn()
          .mockResolvedValueOnce(ok({ xp: 0, point: 0, missions: [], vouchers: [], badges: [] }))
          .mockResolvedValue(ok({ xp: 100, point: 20, missions: ["keliling"], vouchers: [], badges: [] })),
        reconcile: vi.fn().mockResolvedValue(ok({ ok: true, applied: true, totals: { xp: 100, point: 20 } })),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().hydrated).toBe(true));
    expect(gameStore.getState().xp).toBe(100);
    expect(storage.getItem("koperasi.xp")).toBeNull(); // legacy keys cleared
    expect(storage.getItem("koperasi.missions")).toBeNull();
  });

  it("drops a stale hydrate when the owner changes mid-flight (epoch+uid guard)", async () => {
    let resolveFirst: (v: RepoResult<unknown>) => void = () => {};
    const first = new Promise<RepoResult<unknown>>((r) => {
      resolveFirst = r;
    });
    const { gameStore } = await loadStore({
      online: true,
      repo: {
        getMyProgress: vi
          .fn()
          .mockReturnValueOnce(first)
          .mockResolvedValue(ok({ xp: 7, point: 0, missions: [], vouchers: [], badges: [] })),
      },
    });
    gameStore.getState().onOwnerChanged("user-A"); // hydrate A hangs
    gameStore.getState().onOwnerChanged("user-B"); // switch before A resolves
    await vi.waitFor(() => expect(gameStore.getState().hydrated).toBe(true)); // B hydrated
    resolveFirst(ok({ xp: 500, point: 500, missions: [], vouchers: [], badges: [] }));
    await Promise.resolve();
    expect(gameStore.getState().xp).toBe(7); // A's late result was dropped by the guard
  });

  it("redeemVoucher rolls back the optimistic debit on RPC error", async () => {
    const { gameStore } = await loadStore({
      online: true,
      repo: {
        getMyProgress: vi
          .fn()
          .mockResolvedValue(ok({ xp: 0, point: 100, missions: [], vouchers: [], badges: [] })),
        redeemVoucher: vi.fn().mockResolvedValue({ status: "rpcError", error: new Error("boom") }),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().point).toBe(100));
    const voucher = await gameStore.getState().redeemVoucher("belanja-5k");
    expect(voucher).toBeNull();
    expect(gameStore.getState().point).toBe(100); // debit reversed
    expect(gameStore.getState().redeemedVouchers).toHaveLength(0);
  });

  it("redeemVoucher rejects without an optimistic debit when the client balance is insufficient", async () => {
    const { gameStore, repo } = await loadStore({
      online: true,
      repo: {
        getMyProgress: vi
          .fn()
          .mockResolvedValue(ok({ xp: 0, point: 10, missions: [], vouchers: [], badges: [] })),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().point).toBe(10));
    const voucher = await gameStore.getState().redeemVoucher("belanja-5k"); // cost 50 > 10
    expect(voucher).toBeNull();
    expect(gameStore.getState().point).toBe(10); // no flash-then-restore
    expect(repo.redeemVoucher).not.toHaveBeenCalled(); // gated before any RPC
  });

  it("retries the boot hydrate once on a transient error", async () => {
    const { gameStore } = await loadStore({
      online: true,
      repo: {
        getMyProgress: vi
          .fn()
          .mockResolvedValueOnce({ status: "rpcError", error: new Error("401") })
          .mockResolvedValue(ok({ xp: 42, point: 0, missions: [], vouchers: [], badges: [] })),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().xp).toBe(42)); // retry succeeded
  });

  it("a failed optimistic mission is fully reversed even when a concurrent claim reconciled in between", async () => {
    // Op A (baca-mading) hangs then fails; op B (keliling) succeeds and reconciles
    // absolute totals in between — which bumps the epoch and would previously have
    // stranded A's phantom mission. The membership rollback must still remove it.
    let failA: (v: RepoResult<unknown>) => void = () => {};
    const aPromise = new Promise<RepoResult<unknown>>((r) => {
      failA = r;
    });
    const { gameStore } = await loadStore({
      online: true,
      repo: {
        claimMission: vi.fn().mockImplementation((missionId: string) =>
          missionId === "baca-mading"
            ? aPromise
            : Promise.resolve(ok({ ok: true, reward: { xp: 10, point: 10 }, totals: { xp: 10, point: 10 } })),
        ),
      },
    });
    gameStore.getState().onOwnerChanged("user-A");
    await vi.waitFor(() => expect(gameStore.getState().hydrated).toBe(true));

    const aDone = gameStore.getState().completeMission("baca-mading"); // optimistic, hangs
    await gameStore.getState().completeMission("keliling"); // reconciles totals → epoch bumps
    failA({ status: "rpcError", error: new Error("boom") });
    await aDone;

    const ids = gameStore.getState().completedMissionIds;
    expect(ids).toContain("keliling"); // B kept
    expect(ids).not.toContain("baca-mading"); // A's phantom removed despite the epoch bump
  });
});
