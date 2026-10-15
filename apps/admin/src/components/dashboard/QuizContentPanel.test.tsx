// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listQuiz: vi.fn(),
  upsertQuizQuestion: vi.fn(),
  deleteQuizQuestion: vi.fn(),
}));

vi.mock("../../lib/adminApi", () => ({
  listQuiz: h.listQuiz,
  upsertQuizQuestion: h.upsertQuizQuestion,
  deleteQuizQuestion: h.deleteQuizQuestion,
}));
vi.mock("../../stores/adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: vi.fn(), gate: { status: "authorized" } }) },
}));

import { QuizContentPanel } from "./QuizContentPanel";
import {
  quizContentStore,
  __resetQuizContentForTest,
  type QuizUiState,
} from "../../stores/quizContent.store";
import type { QuizQuestion } from "../../lib/adminApi";

afterEach(() => {
  cleanup();
  __resetQuizContentForTest();
  vi.restoreAllMocks();
});
beforeEach(() => {
  h.listQuiz.mockReset();
  h.upsertQuizQuestion.mockReset();
  h.deleteQuizQuestion.mockReset();
  // never resolve in panel tests — we drive state via setState and only assert the call happened
  h.listQuiz.mockReturnValue(new Promise(() => {}));
  h.upsertQuizQuestion.mockReturnValue(new Promise(() => {}));
  h.deleteQuizQuestion.mockReturnValue(new Promise(() => {}));
});

const row = (code: string, over: Partial<QuizQuestion> = {}): QuizQuestion => ({
  code,
  prompt: "P",
  options: ["a", "b"],
  correct_index: 0,
  explanation: null,
  sort_order: 0,
  updated_at: "t0",
  ...over,
});

function setState(s: QuizUiState) {
  quizContentStore.setState({ state: s });
}
const ready = (rows: QuizQuestion[], over: Partial<{ refreshing: boolean; mutating: unknown }> = {}) =>
  setState({ status: "ready", rows, refreshing: false, mutating: null, ...over } as QuizUiState);

describe("QuizContentPanel", () => {
  it("loading shows a message", () => {
    setState({ status: "loading" });
    render(<QuizContentPanel />);
    expect(screen.getByText(/Memuat kuis/)).toBeTruthy();
  });

  it("error shows a retry button", () => {
    setState({ status: "error" });
    render(<QuizContentPanel />);
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });

  it("ready renders question rows + the add button", () => {
    ready([row("q1"), row("q2")]);
    render(<QuizContentPanel />);
    expect(screen.getByText("q1")).toBeTruthy();
    expect(screen.getByText("q2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tambah pertanyaan" })).toBeTruthy();
  });

  it("empty rows → empty-state message", () => {
    ready([]);
    render(<QuizContentPanel />);
    expect(screen.getByText(/Belum ada pertanyaan/)).toBeTruthy();
  });

  it("toast is shown", () => {
    quizContentStore.setState({ toast: { tone: "success", text: 'Pertanyaan "q3" tersimpan.' } });
    ready([row("q1")]);
    render(<QuizContentPanel />);
    expect(screen.getByText('Pertanyaan "q3" tersimpan.')).toBeTruthy();
  });

  it("Tambah pertanyaan opens a blank form with Save disabled", () => {
    ready([row("q1")]);
    render(<QuizContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah pertanyaan" }));
    expect(screen.getByText("Pertanyaan baru")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Ubah opens a prefilled form (code immutable) and saving calls the store with the CAS token", () => {
    ready([row("q1", { updated_at: "t-cas" })]);
    render(<QuizContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ubah" }));
    expect(screen.getByText(/Ubah pertanyaan/)).toBeTruthy();
    // code is immutable on edit
    expect((screen.getByPlaceholderText(/koperasi-01/) as HTMLInputElement).disabled).toBe(true);
    const save = screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false); // prefilled form is complete
    fireEvent.click(save);
    expect(h.upsertQuizQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ code: "q1", prev_updated_at: "t-cas" }),
    );
  });

  it("while deleting a row, the add button + that row's delete are disabled", () => {
    ready([row("q1"), row("q2")], { mutating: { kind: "deleting", code: "q1" } });
    render(<QuizContentPanel />);
    expect((screen.getByRole("button", { name: "Tambah pertanyaan" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Menghapus…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("delete asks window.confirm; confirmed → store.remove(code)", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    ready([row("q1"), row("q2")]);
    render(<QuizContentPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Hapus" })[0]!); // q1's delete
    expect(confirm).toHaveBeenCalledWith('Hapus pertanyaan "q1" — tidak bisa dibatalkan');
    expect(h.deleteQuizQuestion).toHaveBeenCalledWith("q1");
  });

  it("delete cancelled at the confirm → no store call", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    ready([row("q1")]);
    render(<QuizContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(h.deleteQuizQuestion).not.toHaveBeenCalled();
  });
});
