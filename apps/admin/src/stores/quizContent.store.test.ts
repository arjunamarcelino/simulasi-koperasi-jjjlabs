import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizQuestion, QuizUpsertInput } from "../lib/adminApi";

const h = vi.hoisted(() => ({
  listQuiz: vi.fn(),
  upsertQuizQuestion: vi.fn(),
  deleteQuizQuestion: vi.fn(),
  retry: vi.fn(),
  gateStatus: "authorized" as string,
}));

vi.mock("../lib/adminApi", () => ({
  listQuiz: h.listQuiz,
  upsertQuizQuestion: h.upsertQuizQuestion,
  deleteQuizQuestion: h.deleteQuizQuestion,
}));
vi.mock("./adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: h.retry, gate: { status: h.gateStatus } }) },
}));

import { quizContentStore, __resetQuizContentForTest } from "./quizContent.store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => quizContentStore.getState().state;
const toast = () => quizContentStore.getState().toast;

const row = (code: string): QuizQuestion => ({
  code,
  prompt: "P",
  options: ["a", "b"],
  correct_index: 0,
  explanation: null,
  sort_order: 0,
  updated_at: "t0",
});
const LIST = [row("q1"), row("q2")];

const INPUT: QuizUpsertInput = {
  code: "q3",
  prompt: "P3",
  options: ["a", "b", "c"],
  correct_index: 1,
  explanation: null,
  sort_order: 2,
  prev_updated_at: null,
};

beforeEach(() => {
  h.listQuiz.mockReset();
  h.upsertQuizQuestion.mockReset();
  h.deleteQuizQuestion.mockReset();
  h.retry.mockReset();
  h.retry.mockResolvedValue(undefined);
  h.listQuiz.mockResolvedValue({ kind: "serviceUnavailable" }); // fallback for stray refetches
  h.gateStatus = "authorized";
  __resetQuizContentForTest();
});

async function ready() {
  h.listQuiz.mockResolvedValueOnce({ kind: "ok", data: LIST });
  quizContentStore.getState().load();
  await flush();
}

describe("quizContent store — reads", () => {
  it("starts idle", () => {
    expect(state()).toEqual({ status: "idle" });
  });

  it("load → loading → ready{rows, refreshing:false, mutating:null}", async () => {
    h.listQuiz.mockResolvedValueOnce({ kind: "ok", data: LIST });
    quizContentStore.getState().load();
    expect(state().status).toBe("loading");
    await flush();
    expect(state()).toEqual({ status: "ready", rows: LIST, refreshing: false, mutating: null });
  });

  it("load fetches ONCE (StrictMode double-mount guard)", async () => {
    h.listQuiz.mockResolvedValue({ kind: "ok", data: LIST });
    quizContentStore.getState().load();
    quizContentStore.getState().load();
    await flush();
    expect(h.listQuiz).toHaveBeenCalledTimes(1);
  });

  it("serviceUnavailable → error, retry refetches", async () => {
    h.listQuiz.mockResolvedValue({ kind: "serviceUnavailable" });
    quizContentStore.getState().load();
    await flush();
    expect(state()).toEqual({ status: "error" });
    quizContentStore.getState().retry();
    await flush();
    expect(h.listQuiz).toHaveBeenCalledTimes(2);
  });

  it("auth-loss bridges to the gate once and stays passive (authLost)", async () => {
    h.listQuiz.mockResolvedValue({ kind: "unauthenticated" });
    h.retry.mockImplementation(async () => {
      h.gateStatus = "unauthenticated";
    });
    quizContentStore.getState().load();
    await flush();
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: "authLost" });
  });
});

describe("quizContent store — save", () => {
  it("create ok → success toast + refetch + resolves true", async () => {
    await ready();
    h.upsertQuizQuestion.mockResolvedValue({ kind: "ok", data: row("q3") });
    h.listQuiz.mockResolvedValueOnce({ kind: "ok", data: [...LIST, row("q3")] });
    const committed = await quizContentStore.getState().save(INPUT);
    expect(committed).toBe(true);
    expect(h.upsertQuizQuestion).toHaveBeenCalledWith(INPUT);
    expect(toast()).toEqual({ tone: "success", text: 'Pertanyaan "q3" tersimpan.' });
    await flush();
    expect(h.listQuiz).toHaveBeenCalledTimes(2); // load + refetch
  });

  it("edit forwards prev_updated_at (CAS token)", async () => {
    await ready();
    h.upsertQuizQuestion.mockResolvedValue({ kind: "ok", data: row("q1") });
    await quizContentStore.getState().save({ ...INPUT, code: "q1", prev_updated_at: "t0" });
    expect(h.upsertQuizQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ code: "q1", prev_updated_at: "t0" }),
    );
  });

  it("conflict duplicate_code → error toast, NO refetch, resolves false", async () => {
    await ready();
    h.upsertQuizQuestion.mockResolvedValue({ kind: "conflict", reason: "duplicate_code" });
    const committed = await quizContentStore.getState().save(INPUT);
    expect(committed).toBe(false);
    expect(toast()?.tone).toBe("error");
    await flush();
    expect(h.listQuiz).toHaveBeenCalledTimes(1); // no refetch for a pure duplicate
  });

  it("conflict stale_write → error toast + refetch", async () => {
    await ready();
    h.upsertQuizQuestion.mockResolvedValue({ kind: "conflict", reason: "stale_write" });
    h.listQuiz.mockResolvedValueOnce({ kind: "ok", data: LIST });
    const committed = await quizContentStore.getState().save(INPUT);
    expect(committed).toBe(false);
    await flush();
    expect(h.listQuiz).toHaveBeenCalledTimes(2);
  });

  it("rejected (422) → error toast, resolves false, no refetch", async () => {
    await ready();
    h.upsertQuizQuestion.mockResolvedValue({ kind: "rejected", reason: "options_len" });
    const committed = await quizContentStore.getState().save(INPUT);
    expect(committed).toBe(false);
    expect(toast()?.tone).toBe("error");
    await flush();
    expect(h.listQuiz).toHaveBeenCalledTimes(1);
  });

  it("serviceUnavailable → refetch (may have committed), resolves false", async () => {
    await ready();
    h.upsertQuizQuestion.mockResolvedValue({ kind: "serviceUnavailable" });
    h.listQuiz.mockResolvedValueOnce({ kind: "ok", data: LIST });
    const committed = await quizContentStore.getState().save(INPUT);
    expect(committed).toBe(false);
    await flush();
    expect(h.listQuiz).toHaveBeenCalledTimes(2);
  });

  it("auth loss → bridge, resolves false", async () => {
    await ready();
    h.upsertQuizQuestion.mockResolvedValue({ kind: "notAuthorized" });
    const committed = await quizContentStore.getState().save(INPUT);
    expect(committed).toBe(false);
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(toast()?.text).toContain("sesi admin berakhir");
  });

  it("mutation gate blocks a concurrent save", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.upsertQuizQuestion.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p1 = quizContentStore.getState().save(INPUT);
    const blocked = await quizContentStore.getState().save(INPUT); // gated
    expect(blocked).toBe(false);
    expect(h.upsertQuizQuestion).toHaveBeenCalledTimes(1);
    const s = state();
    expect(s.status === "ready" && s.mutating).toEqual({ kind: "saving" });
    resolve({ kind: "serviceUnavailable" });
    await p1;
    await flush();
  });

  it("ZOMBIE save: resolves after dispose() → dropped (idle, no toast, no refetch)", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.upsertQuizQuestion.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const p = quizContentStore.getState().save(INPUT);
    quizContentStore.getState().dispose();
    resolve({ kind: "ok", data: row("q3") });
    await p;
    await flush();
    expect(state()).toEqual({ status: "idle" });
    expect(toast()).toBeNull();
    expect(h.listQuiz).toHaveBeenCalledTimes(1); // no post-save refetch
  });
});

describe("quizContent store — delete", () => {
  it("delete ok → success toast + refetch", async () => {
    await ready();
    h.deleteQuizQuestion.mockResolvedValue({ kind: "ok" });
    h.listQuiz.mockResolvedValueOnce({ kind: "ok", data: [row("q2")] });
    quizContentStore.getState().remove("q1");
    await flush();
    await flush();
    expect(toast()).toEqual({ tone: "success", text: 'Pertanyaan "q1" dihapus.' });
    expect(h.listQuiz).toHaveBeenCalledTimes(2);
  });

  it("blocked has_completions → error toast, NO refetch", async () => {
    await ready();
    h.deleteQuizQuestion.mockResolvedValue({ kind: "blocked", reason: "has_completions" });
    quizContentStore.getState().remove("q1");
    await flush();
    expect(toast()?.tone).toBe("error");
    expect(toast()?.text).toContain("sudah pernah dijawab");
    expect(h.listQuiz).toHaveBeenCalledTimes(1); // row kept, no refetch
  });

  it("notFound → treated as success (refetch)", async () => {
    await ready();
    h.deleteQuizQuestion.mockResolvedValue({ kind: "notFound" });
    h.listQuiz.mockResolvedValueOnce({ kind: "ok", data: [row("q2")] });
    quizContentStore.getState().remove("q1");
    await flush();
    await flush();
    expect(toast()?.tone).toBe("success");
    expect(state().status).toBe("ready");
  });

  it("mutation gate blocks delete∥save", async () => {
    await ready();
    let resolve!: (v: unknown) => void;
    h.deleteQuizQuestion.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    quizContentStore.getState().remove("q1");
    const blockedSave = await quizContentStore.getState().save(INPUT); // gated by delete-in-flight
    expect(blockedSave).toBe(false);
    expect(h.upsertQuizQuestion).not.toHaveBeenCalled();
    expect(h.deleteQuizQuestion).toHaveBeenCalledTimes(1);
    resolve({ kind: "serviceUnavailable" });
    await flush();
    await flush();
  });
});
