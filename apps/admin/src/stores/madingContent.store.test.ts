import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MadingGroups, MadingItem, MadingUpsertInput } from "../lib/adminApi";

const h = vi.hoisted(() => ({
  listMading: vi.fn(),
  upsertMadingBlock: vi.fn(),
  deleteMadingBlock: vi.fn(),
  retry: vi.fn(),
  gateStatus: "authorized" as string,
}));

vi.mock("../lib/adminApi", () => ({
  listMading: h.listMading,
  upsertMadingBlock: h.upsertMadingBlock,
  deleteMadingBlock: h.deleteMadingBlock,
}));
vi.mock("./adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: h.retry, gate: { status: h.gateStatus } }) },
}));

import { madingContentStore, __resetMadingContentForTest } from "./madingContent.store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => madingContentStore.getState().state;
const toast = () => madingContentStore.getState().toast;

const item = (id: string, bk: string): MadingItem => ({
  id,
  block_key: bk,
  payload: { title: "T", lines: ["a"], accent: "mustard" },
  sort_order: 0,
  updated_at: "t0",
});
const GROUPS: MadingGroups = { info: [item("i1", "info-0")], data: [], knowledge: [], identitas: null };

const INPUT: MadingUpsertInput = {
  id: null,
  board: "info",
  block_key: "info-9",
  payload: { title: "N", lines: ["a"], accent: "forest" },
  sort_order: 1,
  prev_updated_at: null,
};

beforeEach(() => {
  h.listMading.mockReset();
  h.upsertMadingBlock.mockReset();
  h.deleteMadingBlock.mockReset();
  h.retry.mockReset();
  h.retry.mockResolvedValue(undefined);
  h.listMading.mockResolvedValue({ kind: "serviceUnavailable" });
  h.gateStatus = "authorized";
  __resetMadingContentForTest();
});

async function ready() {
  h.listMading.mockResolvedValueOnce({ kind: "ok", data: GROUPS });
  madingContentStore.getState().load();
  await flush();
}

describe("madingContent store — reads", () => {
  it("load → loading → ready", async () => {
    h.listMading.mockResolvedValueOnce({ kind: "ok", data: GROUPS });
    madingContentStore.getState().load();
    expect(state().status).toBe("loading");
    await flush();
    expect(state()).toEqual({ status: "ready", groups: GROUPS, refreshing: false, mutating: null });
  });

  it("load fetches ONCE", async () => {
    h.listMading.mockResolvedValue({ kind: "ok", data: GROUPS });
    madingContentStore.getState().load();
    madingContentStore.getState().load();
    await flush();
    expect(h.listMading).toHaveBeenCalledTimes(1);
  });

  it("serviceUnavailable → error + retry", async () => {
    h.listMading.mockResolvedValue({ kind: "serviceUnavailable" });
    madingContentStore.getState().load();
    await flush();
    expect(state()).toEqual({ status: "error" });
    madingContentStore.getState().retry();
    await flush();
    expect(h.listMading).toHaveBeenCalledTimes(2);
  });

  it("auth loss → authLost + bridge once", async () => {
    h.listMading.mockResolvedValue({ kind: "unauthenticated" });
    h.retry.mockImplementation(async () => {
      h.gateStatus = "unauthenticated";
    });
    madingContentStore.getState().load();
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "authLost" });
  });
});

describe("madingContent store — save/delete", () => {
  it("create ok → success toast + refetch + true", async () => {
    await ready();
    h.upsertMadingBlock.mockResolvedValue({ kind: "ok", data: { ...item("i2", "info-9"), board: "info" } });
    h.listMading.mockResolvedValueOnce({ kind: "ok", data: GROUPS });
    const committed = await madingContentStore.getState().save(INPUT);
    expect(committed).toBe(true);
    expect(h.upsertMadingBlock).toHaveBeenCalledWith(INPUT);
    expect(toast()?.tone).toBe("success");
    await flush();
    expect(h.listMading).toHaveBeenCalledTimes(2);
  });

  it("identitas_exists conflict → specific toast, no refetch, false", async () => {
    await ready();
    h.upsertMadingBlock.mockResolvedValue({ kind: "conflict", reason: "identitas_exists" });
    const committed = await madingContentStore.getState().save({ ...INPUT, board: "identitas" });
    expect(committed).toBe(false);
    expect(toast()?.text).toContain("Identitas");
    await flush();
    expect(h.listMading).toHaveBeenCalledTimes(1);
  });

  it("stale_write conflict → refetch", async () => {
    await ready();
    h.upsertMadingBlock.mockResolvedValue({ kind: "conflict", reason: "stale_write" });
    h.listMading.mockResolvedValueOnce({ kind: "ok", data: GROUPS });
    await madingContentStore.getState().save(INPUT);
    await flush();
    expect(h.listMading).toHaveBeenCalledTimes(2);
  });

  it("rejected (422) → error toast, no refetch, false", async () => {
    await ready();
    h.upsertMadingBlock.mockResolvedValue({ kind: "rejected", reason: "info_accent" });
    const committed = await madingContentStore.getState().save(INPUT);
    expect(committed).toBe(false);
    expect(toast()?.tone).toBe("error");
    await flush();
    expect(h.listMading).toHaveBeenCalledTimes(1);
  });

  it("mutation gate blocks a concurrent save", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.upsertMadingBlock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p1 = madingContentStore.getState().save(INPUT);
    const blocked = await madingContentStore.getState().save(INPUT);
    expect(blocked).toBe(false);
    expect(h.upsertMadingBlock).toHaveBeenCalledTimes(1);
    resolve({ kind: "serviceUnavailable" });
    await p1;
    await flush();
  });

  it("ZOMBIE save after dispose → dropped (idle, no toast)", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.upsertMadingBlock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p = madingContentStore.getState().save(INPUT);
    madingContentStore.getState().dispose();
    resolve({ kind: "ok", data: { ...item("i2", "info-9"), board: "info" } });
    await p;
    await flush();
    expect(state()).toEqual({ status: "idle" });
    expect(toast()).toBeNull();
  });

  it("delete ok → success + refetch", async () => {
    await ready();
    h.deleteMadingBlock.mockResolvedValue({ kind: "ok" });
    h.listMading.mockResolvedValueOnce({ kind: "ok", data: GROUPS });
    madingContentStore.getState().remove("i1");
    await flush();
    await flush();
    expect(toast()?.tone).toBe("success");
    expect(h.listMading).toHaveBeenCalledTimes(2);
  });

  it("delete gate blocks delete∥save", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.deleteMadingBlock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    madingContentStore.getState().remove("i1");
    const blockedSave = await madingContentStore.getState().save(INPUT);
    expect(blockedSave).toBe(false);
    expect(h.upsertMadingBlock).not.toHaveBeenCalled();
    resolve({ kind: "serviceUnavailable" });
    await flush();
    await flush();
  });
});
