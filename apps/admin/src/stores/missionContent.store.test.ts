import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionRow } from "../lib/adminApi";

const h = vi.hoisted(() => ({
  listMissions: vi.fn(),
  rotateMissionCode: vi.fn(),
  retry: vi.fn(),
  gateStatus: "authorized" as string,
}));

vi.mock("../lib/adminApi", () => ({
  listMissions: h.listMissions,
  rotateMissionCode: h.rotateMissionCode,
}));
vi.mock("./adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: h.retry, gate: { status: h.gateStatus } }) },
}));

import { missionContentStore, __resetMissionContentForTest } from "./missionContent.store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => missionContentStore.getState().state;
const toast = () => missionContentStore.getState().toast;

const row = (code: string, redeem = "C1"): MissionRow => ({
  code,
  title: "T",
  redeem_code: redeem,
  redeem_code_updated_at: null,
  redeem_code_updated_by: null,
});
const LIST = [row("kunjungi-kdmp"), row("impact-umkm")];

beforeEach(() => {
  h.listMissions.mockReset();
  h.rotateMissionCode.mockReset();
  h.retry.mockReset();
  h.retry.mockResolvedValue(undefined);
  h.listMissions.mockResolvedValue({ kind: "serviceUnavailable" }); // fallback for stray refetches
  h.gateStatus = "authorized";
  __resetMissionContentForTest();
});

async function ready() {
  h.listMissions.mockResolvedValueOnce({ kind: "ok", data: LIST });
  missionContentStore.getState().load();
  await flush();
}

describe("missionContent store — reads", () => {
  it("starts idle", () => {
    expect(state()).toEqual({ status: "idle" });
  });

  it("load → loading → ready", async () => {
    h.listMissions.mockResolvedValueOnce({ kind: "ok", data: LIST });
    missionContentStore.getState().load();
    expect(state().status).toBe("loading");
    await flush();
    expect(state()).toEqual({ status: "ready", rows: LIST, refreshing: false, mutating: null });
  });

  it("load fetches ONCE (StrictMode double-mount guard)", async () => {
    h.listMissions.mockResolvedValue({ kind: "ok", data: LIST });
    missionContentStore.getState().load();
    missionContentStore.getState().load();
    await flush();
    expect(h.listMissions).toHaveBeenCalledTimes(1);
  });

  it("serviceUnavailable → error, retry refetches", async () => {
    h.listMissions.mockResolvedValue({ kind: "serviceUnavailable" });
    missionContentStore.getState().load();
    await flush();
    expect(state()).toEqual({ status: "error" });
    missionContentStore.getState().retry();
    await flush();
    expect(h.listMissions).toHaveBeenCalledTimes(2);
  });

  it("auth-loss bridges to the gate once and stays passive (authLost)", async () => {
    h.listMissions.mockResolvedValue({ kind: "unauthenticated" });
    h.retry.mockImplementation(async () => {
      h.gateStatus = "unauthenticated";
    });
    missionContentStore.getState().load();
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "authLost" });
  });
});

describe("missionContent store — rotate", () => {
  it("ok → success toast + refetch + resolves true", async () => {
    await ready();
    h.rotateMissionCode.mockResolvedValue({ kind: "ok", data: row("kunjungi-kdmp", "NEW") });
    h.listMissions.mockResolvedValueOnce({ kind: "ok", data: [row("kunjungi-kdmp", "NEW"), row("impact-umkm")] });
    const committed = await missionContentStore.getState().rotate("kunjungi-kdmp", "NEW");
    expect(committed).toBe(true);
    expect(h.rotateMissionCode).toHaveBeenCalledWith("kunjungi-kdmp", "NEW");
    expect(toast()).toEqual({ tone: "success", text: 'Kode misi "kunjungi-kdmp" dirotasi.' });
    await flush();
    expect(h.listMissions).toHaveBeenCalledTimes(2); // load + refetch
  });

  it("rejected (422) → generic error toast, resolves false, NO refetch (draft kept by panel)", async () => {
    await ready();
    h.rotateMissionCode.mockResolvedValue({ kind: "rejected", reason: "some_boundary_msg" });
    const committed = await missionContentStore.getState().rotate("kunjungi-kdmp", "bad");
    expect(committed).toBe(false);
    expect(toast()?.tone).toBe("error");
    expect(toast()?.text).toContain("Input ditolak");
    await flush();
    expect(h.listMissions).toHaveBeenCalledTimes(1);
  });

  it("notFound → error toast + refetch", async () => {
    await ready();
    h.rotateMissionCode.mockResolvedValue({ kind: "notFound" });
    h.listMissions.mockResolvedValueOnce({ kind: "ok", data: LIST });
    const committed = await missionContentStore.getState().rotate("gone", "X");
    expect(committed).toBe(false);
    await flush();
    expect(h.listMissions).toHaveBeenCalledTimes(2);
  });

  it("serviceUnavailable → refetch (may have committed), resolves false", async () => {
    await ready();
    h.rotateMissionCode.mockResolvedValue({ kind: "serviceUnavailable" });
    h.listMissions.mockResolvedValueOnce({ kind: "ok", data: LIST });
    const committed = await missionContentStore.getState().rotate("kunjungi-kdmp", "X");
    expect(committed).toBe(false);
    await flush();
    expect(h.listMissions).toHaveBeenCalledTimes(2);
  });

  it("auth loss → bridge, resolves false", async () => {
    await ready();
    h.rotateMissionCode.mockResolvedValue({ kind: "notAuthorized" });
    const committed = await missionContentStore.getState().rotate("kunjungi-kdmp", "X");
    expect(committed).toBe(false);
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(toast()?.text).toContain("sesi admin berakhir");
  });

  it("mutation gate blocks a concurrent rotate; mutating carries the code", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.rotateMissionCode.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p1 = missionContentStore.getState().rotate("kunjungi-kdmp", "A");
    const blocked = await missionContentStore.getState().rotate("impact-umkm", "B"); // gated
    expect(blocked).toBe(false);
    expect(h.rotateMissionCode).toHaveBeenCalledTimes(1);
    const s = state();
    expect(s.status === "ready" && s.mutating).toEqual({ kind: "rotating", code: "kunjungi-kdmp" });
    resolve({ kind: "serviceUnavailable" });
    await p1;
    await flush();
  });

  it("ZOMBIE rotate: resolves after dispose() → dropped (idle, no toast, no refetch)", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.rotateMissionCode.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p = missionContentStore.getState().rotate("kunjungi-kdmp", "A");
    missionContentStore.getState().dispose();
    resolve({ kind: "ok", data: row("kunjungi-kdmp", "A") });
    await p;
    await flush();
    expect(state()).toEqual({ status: "idle" });
    expect(toast()).toBeNull();
    expect(h.listMissions).toHaveBeenCalledTimes(1); // no post-rotate refetch
  });
});
