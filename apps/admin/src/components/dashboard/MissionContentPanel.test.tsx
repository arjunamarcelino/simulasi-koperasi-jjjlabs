// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listMissions: vi.fn(),
  rotateMissionCode: vi.fn(),
}));

vi.mock("../../lib/adminApi", () => ({
  listMissions: h.listMissions,
  rotateMissionCode: h.rotateMissionCode,
}));
vi.mock("../../stores/adminAuth.store", () => ({
  adminAuthStore: { getState: () => ({ retry: vi.fn(), gate: { status: "authorized" } }) },
}));

import { MissionContentPanel } from "./MissionContentPanel";
import {
  missionContentStore,
  __resetMissionContentForTest,
  type MissionUiState,
} from "../../stores/missionContent.store";
import type { MissionRow } from "../../lib/adminApi";

afterEach(() => {
  cleanup();
  __resetMissionContentForTest();
  vi.restoreAllMocks();
});
beforeEach(() => {
  h.listMissions.mockReset();
  h.rotateMissionCode.mockReset();
  // never resolve — drive state via setState; only assert the call happened
  h.listMissions.mockReturnValue(new Promise(() => {}));
  h.rotateMissionCode.mockReturnValue(new Promise(() => {}));
});

const row = (code: string, over: Partial<MissionRow> = {}): MissionRow => ({
  code,
  title: "Judul " + code,
  redeem_code: "C-" + code,
  redeem_code_updated_at: null,
  redeem_code_updated_by: null,
  ...over,
});

function setState(s: MissionUiState) {
  act(() => missionContentStore.setState({ state: s }));
}
const ready = (rows: MissionRow[], over: Partial<{ refreshing: boolean; mutating: unknown }> = {}) =>
  setState({ status: "ready", rows, refreshing: false, mutating: null, ...over } as MissionUiState);

describe("MissionContentPanel", () => {
  it("lists reallife missions with code, title, current redeem_code and audit", () => {
    render(<MissionContentPanel />);
    ready([
      row("kunjungi-kdmp", { redeem_code: "KDMP2026" }),
      row("impact-umkm", {
        redeem_code: "UMKM2026",
        redeem_code_updated_at: "2026-10-14T09:00:00.000000Z",
        redeem_code_updated_by: "abcd1234-ffff",
      }),
    ]);
    expect(screen.getByText("kunjungi-kdmp")).toBeTruthy();
    expect(screen.getByText("KDMP2026")).toBeTruthy();
    expect(screen.getByText("belum dirotasi")).toBeTruthy(); // never-rotated row
    expect(screen.getByText(/2026-10-14 · abcd1234/)).toBeTruthy(); // rotated row audit
  });

  it("has no add or delete controls (rotate-only scope)", () => {
    render(<MissionContentPanel />);
    ready([row("kunjungi-kdmp")]);
    expect(screen.queryByText(/Tambah/)).toBeNull();
    expect(screen.queryByText(/Hapus/)).toBeNull();
  });

  it("'Ubah kode' opens an input prefilled with the current code; Save forwards the trimmed value", () => {
    render(<MissionContentPanel />);
    ready([row("kunjungi-kdmp", { redeem_code: "OLD" })]);
    fireEvent.click(screen.getByText("Ubah kode"));
    const input = screen.getByLabelText("Kode unlock untuk kunjungi-kdmp") as HTMLInputElement;
    expect(input.value).toBe("OLD");
    fireEvent.change(input, { target: { value: "  NEW2026  " } });
    fireEvent.click(screen.getByText("Simpan"));
    expect(h.rotateMissionCode).toHaveBeenCalledWith("kunjungi-kdmp", "NEW2026");
  });

  it("Save is disabled for a whitespace-only code (panel trims before the blank check)", () => {
    render(<MissionContentPanel />);
    ready([row("kunjungi-kdmp", { redeem_code: "OLD" })]);
    fireEvent.click(screen.getByText("Ubah kode"));
    const input = screen.getByLabelText("Kode unlock untuk kunjungi-kdmp");
    fireEvent.change(input, { target: { value: "   " } });
    expect((screen.getByText("Simpan") as HTMLButtonElement).disabled).toBe(true);
    expect(h.rotateMissionCode).not.toHaveBeenCalled();
  });

  it("per-row gate: while one row rotates, the other row's control is disabled; the active row shows busy", () => {
    render(<MissionContentPanel />);
    ready([row("kunjungi-kdmp", { redeem_code: "A" }), row("impact-umkm", { redeem_code: "B" })]);
    fireEvent.click(screen.getAllByText("Ubah kode")[0]!); // edit row 1
    setState({
      status: "ready",
      rows: [row("kunjungi-kdmp", { redeem_code: "A" }), row("impact-umkm", { redeem_code: "B" })],
      refreshing: false,
      mutating: { kind: "rotating", code: "kunjungi-kdmp" },
    });
    expect(screen.getByText("Menyimpan…")).toBeTruthy(); // active row indicator
    expect((screen.getByText("Ubah kode") as HTMLButtonElement).disabled).toBe(true); // row 2 gated
  });

  it("renders server truth (row.redeem_code), not a stale draft, after a refetch", () => {
    render(<MissionContentPanel />);
    ready([row("kunjungi-kdmp", { redeem_code: "OLD" })]);
    fireEvent.click(screen.getByText("Ubah kode"));
    // a concurrent refetch replaces the row's code; the (still-open) edit is row-local, but the
    // table cell for a non-editing render shows server truth — assert the store value wins.
    setState({ status: "ready", rows: [row("kunjungi-kdmp", { redeem_code: "SERVER" })], refreshing: false, mutating: null });
    // close the editor to view the table cell
    fireEvent.click(screen.getByText("Batal"));
    expect(screen.getByText("SERVER")).toBeTruthy();
  });

  it("non-ready states render the shared fallback with retry", () => {
    render(<MissionContentPanel />);
    setState({ status: "error" });
    expect(screen.getByText("Tidak dapat memuat kode misi saat ini.")).toBeTruthy();
    fireEvent.click(screen.getByText("Coba lagi"));
    expect(h.listMissions).toHaveBeenCalled(); // retry refetches
  });
});
