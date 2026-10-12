// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listMading: vi.fn(),
  upsertMadingBlock: vi.fn(),
  deleteMadingBlock: vi.fn(),
}));

vi.mock("../../lib/adminApi", () => ({
  listMading: h.listMading,
  upsertMadingBlock: h.upsertMadingBlock,
  deleteMadingBlock: h.deleteMadingBlock,
}));
vi.mock("../../stores/adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: vi.fn(), gate: { status: "authorized" } }) },
}));

import { MadingContentPanel } from "./MadingContentPanel";
import {
  madingContentStore,
  __resetMadingContentForTest,
  type MadingUiState,
} from "../../stores/madingContent.store";
import type { MadingGroups, MadingItem } from "../../lib/adminApi";

afterEach(() => {
  cleanup();
  __resetMadingContentForTest();
  vi.restoreAllMocks();
});
beforeEach(() => {
  h.listMading.mockReset();
  h.upsertMadingBlock.mockReset();
  h.deleteMadingBlock.mockReset();
  h.listMading.mockReturnValue(new Promise(() => {}));
  h.upsertMadingBlock.mockReturnValue(new Promise(() => {}));
  h.deleteMadingBlock.mockReturnValue(new Promise(() => {}));
});

const infoItem = (id: string, bk: string): MadingItem => ({
  id,
  block_key: bk,
  payload: { title: "Judul Info", lines: ["a"], accent: "mustard" },
  sort_order: 0,
  updated_at: "t0",
});
const groups = (over: Partial<MadingGroups> = {}): MadingGroups => ({
  info: [infoItem("i1", "info-0")],
  data: [],
  knowledge: [],
  identitas: null,
  ...over,
});
function setState(s: MadingUiState) {
  madingContentStore.setState({ state: s });
}
const ready = (g: MadingGroups, over: Partial<{ refreshing: boolean; mutating: unknown }> = {}) =>
  setState({ status: "ready", groups: g, refreshing: false, mutating: null, ...over } as MadingUiState);

describe("MadingContentPanel", () => {
  it("loading shows a message", () => {
    setState({ status: "loading" });
    render(<MadingContentPanel />);
    expect(screen.getByText(/Memuat mading/)).toBeTruthy();
  });

  it("error shows a retry button", () => {
    setState({ status: "error" });
    render(<MadingContentPanel />);
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });

  it("renders the 4 board tabs and the active board's items", () => {
    ready(groups());
    render(<MadingContentPanel />);
    for (const label of ["Papan Info", "Papan Data", "Papan Pengetahuan", "Identitas"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByText("info-0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tambah blok" })).toBeTruthy();
  });

  it("empty board shows an empty-state message", () => {
    ready(groups());
    render(<MadingContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Papan Data" }));
    expect(screen.getByText(/Belum ada konten/)).toBeTruthy();
  });

  it("toast is shown", () => {
    madingContentStore.setState({ toast: { tone: "success", text: "Konten mading tersimpan." } });
    ready(groups());
    render(<MadingContentPanel />);
    expect(screen.getByText("Konten mading tersimpan.")).toBeTruthy();
  });

  it("Tambah blok opens a blank form with Save disabled", () => {
    ready(groups());
    render(<MadingContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah blok" }));
    expect(screen.getByText("Blok baru")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Ubah opens a prefilled form with the block key immutable", () => {
    ready(groups());
    render(<MadingContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ubah" }));
    expect(screen.getByText(/Ubah "info-0"/)).toBeTruthy();
    expect((screen.getByPlaceholderText(/info-7/) as HTMLInputElement).disabled).toBe(true);
  });

  it("while deleting, the add button + that row's delete are disabled", () => {
    ready(groups(), { mutating: { kind: "deleting", id: "i1" } });
    render(<MadingContentPanel />);
    expect((screen.getByRole("button", { name: "Tambah blok" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Menghapus…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("delete asks confirm; confirmed → store.remove(id)", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    ready(groups());
    render(<MadingContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(h.deleteMadingBlock).toHaveBeenCalledWith("i1");
  });

  it("identitas tab with no identitas shows the 'Isi identitas' action", () => {
    ready(groups());
    render(<MadingContentPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Identitas" }));
    expect(screen.getByRole("button", { name: "Isi identitas" })).toBeTruthy();
  });
});
