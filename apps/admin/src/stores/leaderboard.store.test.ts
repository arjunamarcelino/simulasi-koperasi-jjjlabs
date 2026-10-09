import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult, DeleteResult, LeaderboardOverview } from "../lib/adminApi";

const h = vi.hoisted(() => ({
  fetchLeaderboardOverview: vi.fn(),
  captureLeaderboardSnapshot: vi.fn(),
  deleteLeaderboardSeason: vi.fn(),
  retry: vi.fn(),
  gateStatus: "authorized" as string,
}));

vi.mock("../lib/adminApi", () => ({
  fetchLeaderboardOverview: h.fetchLeaderboardOverview,
  captureLeaderboardSnapshot: h.captureLeaderboardSnapshot,
  deleteLeaderboardSeason: h.deleteLeaderboardSeason,
}));
vi.mock("./adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: h.retry, gate: { status: h.gateStatus } }) },
}));

import { leaderboardStore, __resetLeaderboardForTest } from "./leaderboard.store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => leaderboardStore.getState().state;
const toast = () => leaderboardStore.getState().toast;

function overview(selId: string | null, seasonIds: string[] = ["s2", "s1"]): LeaderboardOverview {
  const header = (id: string, n: number) => ({
    id,
    season_number: n,
    label: null,
    captured_at: "t",
    entry_count: id === "s1" ? 0 : 2,
  });
  return {
    seasons: seasonIds.map((id, i) => header(id, seasonIds.length - i)),
    selected:
      selId === null
        ? null
        : {
            ...header(selId, 2),
            entries:
              selId === "s1"
                ? []
                : [{ rank: 1, display_name: "Budi", xp: 100, level: 2 }],
          },
  };
}
const CAPTURE: CaptureResult = { season_id: "s3", season_number: 3, captured_at: "t", entry_count: 5 };
const DELETED: DeleteResult = { deleted: true, season_number: 2 };

beforeEach(() => {
  h.fetchLeaderboardOverview.mockReset();
  h.captureLeaderboardSnapshot.mockReset();
  h.deleteLeaderboardSeason.mockReset();
  h.retry.mockReset();
  h.retry.mockResolvedValue(undefined);
  // Fallback for any refetch beyond the per-test `...Once` sequence (keeps the tail from awaiting
  // an undefined mock return and crashing on outcome.kind).
  h.fetchLeaderboardOverview.mockResolvedValue({ kind: "serviceUnavailable" });
  h.gateStatus = "authorized";
  __resetLeaderboardForTest();
});

describe("leaderboard store — reads", () => {
  it("starts idle", () => {
    expect(state()).toEqual({ status: "idle" });
  });

  it("load → loading → ready{data, switching:false, mutating:null}", async () => {
    const ov = overview("s2");
    h.fetchLeaderboardOverview.mockResolvedValue({ kind: "ok", data: ov });
    leaderboardStore.getState().load();
    expect(state().status).toBe("loading");
    await flush();
    expect(state()).toEqual({ status: "ready", data: ov, switching: false, mutating: null });
  });

  it("load fetches the default ONCE (StrictMode double-mount guard)", async () => {
    h.fetchLeaderboardOverview.mockResolvedValue({ kind: "ok", data: overview("s2") });
    leaderboardStore.getState().load();
    leaderboardStore.getState().load(); // no intervening dispose
    await flush();
    expect(h.fetchLeaderboardOverview).toHaveBeenCalledTimes(1);
  });

  it("select keeps the seasons list visible while switching", async () => {
    const ov = overview("s2");
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: ov });
    leaderboardStore.getState().load();
    await flush();
    // next fetch never resolves within this tick → observe the switching state
    let resolve!: (v: unknown) => void;
    h.fetchLeaderboardOverview.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    leaderboardStore.getState().select("s1");
    const s = state();
    expect(s.status).toBe("ready");
    if (s.status === "ready") {
      expect(s.switching).toBe(true);
      expect(s.data.seasons.length).toBe(2); // list still visible
    }
    resolve({ kind: "ok", data: overview("s1") });
    await flush();
    const s2 = state();
    expect(s2.status === "ready" && s2.data.selected?.id).toBe("s1");
    expect(s2.status === "ready" && s2.switching).toBe(false);
  });

  it("serviceUnavailable → error (retryable)", async () => {
    h.fetchLeaderboardOverview.mockResolvedValue({ kind: "serviceUnavailable" });
    leaderboardStore.getState().load();
    await flush();
    expect(state()).toEqual({ status: "error" });
    leaderboardStore.getState().retry();
    await flush();
    expect(h.fetchLeaderboardOverview).toHaveBeenCalledTimes(2);
  });

  it("auth-loss bridges to the gate once and stays passive (authLost)", async () => {
    h.fetchLeaderboardOverview.mockResolvedValue({ kind: "unauthenticated" });
    h.retry.mockImplementation(async () => {
      h.gateStatus = "unauthenticated";
    });
    leaderboardStore.getState().load();
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "authLost" });
  });
});

describe("leaderboard store — capture", () => {
  async function ready(selId = "s2") {
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview(selId) });
    leaderboardStore.getState().load();
    await flush();
  }

  it("capture ok → selects the RETURNED season_id + success toast", async () => {
    await ready();
    h.captureLeaderboardSnapshot.mockResolvedValue({ kind: "ok", data: CAPTURE });
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview("s3", ["s3", "s2", "s1"]) });
    leaderboardStore.getState().capture("Awarding Day");
    await flush();
    await flush();
    expect(h.captureLeaderboardSnapshot).toHaveBeenCalledWith("Awarding Day");
    // refetched with the RETURNED id, not undefined/latest
    expect(h.fetchLeaderboardOverview).toHaveBeenLastCalledWith("s3", expect.anything());
    const s = state();
    expect(s.status === "ready" && s.data.selected?.id).toBe("s3");
    expect(toast()).toEqual({ tone: "success", text: "Musim #3 tersimpan — 5 peserta" });
  });

  it("capture serviceUnavailable → refetches overview (may have committed)", async () => {
    await ready();
    h.captureLeaderboardSnapshot.mockResolvedValue({ kind: "serviceUnavailable" });
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview("s2") });
    leaderboardStore.getState().capture(null);
    await flush();
    await flush();
    expect(h.fetchLeaderboardOverview).toHaveBeenCalledTimes(2); // load + refetch
    expect(toast()?.tone).toBe("error");
  });

  it("capture 401/403 → 'tidak tersimpan' toast + auth bridge (provably not committed)", async () => {
    await ready();
    h.captureLeaderboardSnapshot.mockResolvedValue({ kind: "notAuthorized" });
    leaderboardStore.getState().capture(null);
    await flush();
    expect(toast()?.text).toContain("tidak tersimpan");
    expect(h.retry).toHaveBeenCalledTimes(1);
    // no refetch beyond the initial load (capture did not commit)
    expect(h.fetchLeaderboardOverview).toHaveBeenCalledTimes(1);
  });

  it("mutation gate blocks a double-click capture", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.captureLeaderboardSnapshot.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    leaderboardStore.getState().capture(null);
    leaderboardStore.getState().capture(null); // blocked by the gate
    expect(h.captureLeaderboardSnapshot).toHaveBeenCalledTimes(1);
    const s = state();
    expect(s.status === "ready" && s.mutating).toBe("capturing");
    resolve({ kind: "serviceUnavailable" });
    await flush();
    await flush();
  });

  it("mutation gate blocks a season switch mid-capture (no epoch bump; capture tail survives)", async () => {
    await ready(); // seasons ["s2","s1"]
    let resolve!: (v: unknown) => void;
    h.captureLeaderboardSnapshot.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    leaderboardStore.getState().capture("x");
    leaderboardStore.getState().select("s1"); // wiggling the dropdown mid-capture must be a no-op
    expect(h.fetchLeaderboardOverview).toHaveBeenCalledTimes(1); // the blocked select fired no refetch
    const mid = state();
    expect(mid.status === "ready" && mid.mutating).toBe("capturing");
    // the capture commits → its tail SURVIVES (select did not ++epoch): selects the returned id + toast
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview("s3", ["s3", "s2", "s1"]) });
    resolve({ kind: "ok", data: CAPTURE });
    await flush();
    await flush();
    const s = state();
    expect(s.status === "ready" && s.data.selected?.id).toBe("s3");
    expect(toast()).toEqual({ tone: "success", text: "Musim #3 tersimpan — 5 peserta" });
  });

  it("mutation gate blocks a capture during the trailing switching refetch", async () => {
    await ready();
    h.captureLeaderboardSnapshot.mockResolvedValue({ kind: "ok", data: CAPTURE });
    let resolve!: (v: unknown) => void;
    h.fetchLeaderboardOverview.mockReturnValueOnce(new Promise((r) => (resolve = r))); // refetch hangs
    leaderboardStore.getState().capture(null);
    await flush(); // capture ok → runOverview(switching:true) now in flight, mutating cleared
    const mid = state();
    expect(mid.status === "ready" && mid.switching).toBe(true);
    expect(mid.status === "ready" && mid.mutating).toBeNull();
    leaderboardStore.getState().capture(null); // blocked: busy includes `switching`
    expect(h.captureLeaderboardSnapshot).toHaveBeenCalledTimes(1);
    resolve({ kind: "ok", data: overview("s3", ["s3", "s2", "s1"]) });
    await flush();
  });

  it("ZOMBIE capture: resolves after dispose() → epoch guard drops it (stays idle, no toast)", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.captureLeaderboardSnapshot.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    leaderboardStore.getState().capture("late");
    leaderboardStore.getState().dispose(); // panel closed; epoch bumped
    resolve({ kind: "ok", data: CAPTURE });
    await flush();
    await flush();
    expect(state()).toEqual({ status: "idle" });
    expect(toast()).toBeNull();
    // the ok tail must NOT have fired a post-capture refetch
    expect(h.fetchLeaderboardOverview).toHaveBeenCalledTimes(1);
  });
});

describe("leaderboard store — delete", () => {
  async function ready(selId = "s2", seasonIds = ["s2", "s1"]) {
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview(selId, seasonIds) });
    leaderboardStore.getState().load();
    await flush();
  }

  it("delete the SELECTED season → clears selection to latest before refetch", async () => {
    await ready("s2", ["s2", "s1"]);
    h.deleteLeaderboardSeason.mockResolvedValue({ kind: "ok", data: DELETED });
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview("s1", ["s1"]) });
    leaderboardStore.getState().remove("s2");
    await flush();
    await flush();
    // refetched with undefined (latest), because the deleted id was the selected one
    expect(h.fetchLeaderboardOverview).toHaveBeenLastCalledWith(undefined, expect.anything());
    const s = state();
    expect(s.status === "ready" && s.data.selected?.id).toBe("s1");
    expect(toast()).toEqual({ tone: "success", text: "Musim #2 dihapus." });
  });

  it("delete a NON-selected season → keeps the current selection", async () => {
    await ready("s2", ["s2", "s1"]);
    h.deleteLeaderboardSeason.mockResolvedValue({ kind: "ok", data: { deleted: true, season_number: 1 } });
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview("s2", ["s2"]) });
    leaderboardStore.getState().remove("s1"); // not the selected one
    await flush();
    await flush();
    expect(h.fetchLeaderboardOverview).toHaveBeenLastCalledWith("s2", expect.anything());
  });

  it("delete 404 → treated as success (refresh list, soft toast)", async () => {
    await ready("s2");
    h.deleteLeaderboardSeason.mockResolvedValue({ kind: "notFound" });
    h.fetchLeaderboardOverview.mockResolvedValueOnce({ kind: "ok", data: overview("s1", ["s1"]) });
    leaderboardStore.getState().remove("s2");
    await flush();
    await flush();
    expect(toast()?.tone).toBe("success");
    expect(state().status).toBe("ready");
  });

  it("mutation gate blocks delete∥delete AND capture∥delete", async () => {
    await ready("s2");
    let resolve!: (v: unknown) => void;
    h.deleteLeaderboardSeason.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    leaderboardStore.getState().remove("s2");
    leaderboardStore.getState().remove("s2"); // blocked
    leaderboardStore.getState().capture(null); // blocked
    expect(h.deleteLeaderboardSeason).toHaveBeenCalledTimes(1);
    expect(h.captureLeaderboardSnapshot).not.toHaveBeenCalled();
    resolve({ kind: "serviceUnavailable" });
    await flush();
    await flush();
  });

  it("delete 401/403 → auth bridge, gate flag not wedged", async () => {
    await ready("s2");
    h.deleteLeaderboardSeason.mockResolvedValue({ kind: "unauthenticated" });
    leaderboardStore.getState().remove("s2");
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(toast()?.text).toContain("tidak terhapus");
  });
});
