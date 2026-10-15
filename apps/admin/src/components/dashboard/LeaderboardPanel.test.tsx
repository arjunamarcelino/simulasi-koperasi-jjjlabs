// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  fetchLeaderboardOverview: vi.fn(),
  captureLeaderboardSnapshot: vi.fn(),
  deleteLeaderboardSeason: vi.fn(),
}));

vi.mock("../../lib/adminApi", () => ({
  fetchLeaderboardOverview: h.fetchLeaderboardOverview,
  captureLeaderboardSnapshot: h.captureLeaderboardSnapshot,
  deleteLeaderboardSeason: h.deleteLeaderboardSeason,
}));
vi.mock("../../stores/adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: vi.fn(), gate: { status: "authorized" } }) },
}));

import { LeaderboardPanel } from "./LeaderboardPanel";
import {
  leaderboardStore,
  __resetLeaderboardForTest,
  type LeaderboardUiState,
} from "../../stores/leaderboard.store";
import type { LeaderboardOverview } from "../../lib/adminApi";

afterEach(() => {
  cleanup();
  __resetLeaderboardForTest();
  vi.restoreAllMocks();
});
beforeEach(() => {
  h.fetchLeaderboardOverview.mockReset();
  h.captureLeaderboardSnapshot.mockReset();
  h.deleteLeaderboardSeason.mockReset();
  h.captureLeaderboardSnapshot.mockReturnValue(new Promise(() => {})); // never resolves in tests
  h.deleteLeaderboardSeason.mockReturnValue(new Promise(() => {}));
  h.fetchLeaderboardOverview.mockReturnValue(new Promise(() => {}));
});

function overview(over: Partial<LeaderboardOverview> = {}): LeaderboardOverview {
  return {
    seasons: [
      { id: "s2", season_number: 2, label: "Awarding Day", captured_at: "t", entry_count: 2 },
      { id: "s1", season_number: 1, label: null, captured_at: "t", entry_count: 0 },
    ],
    selected: {
      id: "s2",
      season_number: 2,
      label: "Awarding Day",
      captured_at: "t",
      entry_count: 2,
      entries: [
        { rank: 1, display_name: "Budi", xp: 1500, level: 6 },
        { rank: 2, display_name: "Sari", xp: 900, level: 4 },
      ],
    },
    ...over,
  };
}
function setState(s: LeaderboardUiState) {
  leaderboardStore.setState({ state: s });
}
const ready = (data: LeaderboardOverview, over: Partial<{ switching: boolean; mutating: unknown }> = {}) =>
  setState({ status: "ready", data, switching: false, mutating: null, ...over } as LeaderboardUiState);

describe("LeaderboardPanel", () => {
  it("loading shows a spinner message", () => {
    setState({ status: "loading" });
    render(<LeaderboardPanel />);
    expect(screen.getByText(/Memuat papan peringkat/)).toBeTruthy();
  });

  it("error shows a retry button", () => {
    setState({ status: "error" });
    render(<LeaderboardPanel />);
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });

  it("ready renders rank/name/xp/level rows + the season selector", () => {
    ready(overview());
    render(<LeaderboardPanel />);
    expect(screen.getByText("Budi")).toBeTruthy();
    expect(screen.getByText("Sari")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy(); // the <select>
    expect(screen.getAllByRole("option").length).toBe(2);
  });

  it("empty season (0 entries) → '0 peserta' empty state", () => {
    ready(
      overview({
        selected: { id: "s1", season_number: 1, label: null, captured_at: "t", entry_count: 0, entries: [] },
      }),
    );
    render(<LeaderboardPanel />);
    expect(screen.getByText(/belum memiliki entri/)).toBeTruthy();
  });

  it("no-season state (selected null) prompts the first capture", () => {
    ready(overview({ seasons: [], selected: null }));
    render(<LeaderboardPanel />);
    expect(screen.getByText(/membuat musim pertama/)).toBeTruthy();
  });

  it("success toast is shown", () => {
    leaderboardStore.setState({ toast: { tone: "success", text: "Musim #3 tersimpan — 5 peserta" } });
    ready(overview());
    render(<LeaderboardPanel />);
    expect(screen.getByText("Musim #3 tersimpan — 5 peserta")).toBeTruthy();
  });

  it("while mutating (capturing) the capture button + label input + delete are disabled", () => {
    ready(overview(), { mutating: "capturing" });
    render(<LeaderboardPanel />);
    expect((screen.getByRole("button", { name: "Menyimpan…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText(/Awarding Day/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Hapus musim" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("capture button invokes the store (label trimmed, empty → null)", () => {
    ready(overview());
    render(<LeaderboardPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Ambil snapshot" }));
    expect(h.captureLeaderboardSnapshot).toHaveBeenCalledWith(null);
  });

  it("delete asks window.confirm; confirmed → store.remove(selected.id)", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    ready(overview());
    render(<LeaderboardPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus musim" }));
    expect(confirm).toHaveBeenCalledWith("Hapus Musim #2 — tidak bisa dibatalkan");
    expect(h.deleteLeaderboardSeason).toHaveBeenCalledWith("s2");
  });

  it("delete cancelled at the confirm → no store call", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    ready(overview());
    render(<LeaderboardPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus musim" }));
    expect(h.deleteLeaderboardSeason).not.toHaveBeenCalled();
  });
});
