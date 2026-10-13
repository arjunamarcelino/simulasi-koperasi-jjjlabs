import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MadingDataBoardBody } from "./MadingDataBoard";
import type { Keyed, RepoResult } from "../../lib/madingRepo";
import type { MadingSlide } from "../../lib/mading.types";

// Pure body mirrors LeaderboardMadingBody: assert the APG ARIA + parity chrome via static markup
// in the repo's node env (no jsdom). Listener scoping is verified manually (keyboard + SR at 360px).

const SLIDES: Keyed<MadingSlide>[] = [
  {
    block_key: "d1",
    payload: {
      title: "Daftar Anggota",
      caption: "Per Okt 2026",
      headers: ["Nama", "Status"],
      rows: [["Budi", "Aktif"], ["Siti", "Nonaktif"]],
    },
  },
  { block_key: "d2", payload: { title: "Simpanan", headers: ["Jenis", "Jumlah"], rows: [["Pokok", "100.000"]] } },
];

const render = (result: RepoResult<Keyed<MadingSlide>[]> | null, idx = 0) =>
  renderToStaticMarkup(<MadingDataBoardBody result={result} idx={idx} onSelect={() => {}} />);

describe("MadingDataBoardBody", () => {
  it("exposes APG carousel + slide roles on ok", () => {
    const html = render({ status: "ok", data: SLIDES });
    expect(html).toContain('aria-roledescription="korsel"');
    expect(html).toContain('aria-label="Papan Data"');
    expect(html).toContain('aria-roledescription="salindia"');
    expect(html).toContain('aria-label="Daftar Anggota"'); // slide name = title (content-only, matches knowledge board)
  });

  it("renders the slide title in the labelled heading and names/announces position", () => {
    const html = render({ status: "ok", data: SLIDES }, 0);
    expect(html).toContain('id="mading-data-title"');
    expect(html).toContain("Daftar Anggota");
    expect(html).toContain("Slide 1 dari 2: Daftar Anggota"); // sr-only live region
    expect(html).toContain("Aktif");
  });

  it("back-ports the aria-hidden counter (parity with the knowledge board)", () => {
    const html = render({ status: "ok", data: SLIDES }, 0);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Slide 1 dari 2");
  });

  it("wraps the dot row and keeps the richer per-slide dot labels", () => {
    const html = render({ status: "ok", data: SLIDES }, 0);
    expect(html).toContain("flex flex-wrap");
    expect(html).toContain('aria-label="Ke slide 1: Daftar Anggota"');
    expect(html).toContain('aria-label="Ke slide 2: Simpanan"');
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
  });

  it("guards the table fade against reduced motion", () => {
    const html = render({ status: "ok", data: SLIDES });
    expect(html).toContain("motion-reduce:animate-none");
  });

  it("shows the slide at idx 1", () => {
    const html = render({ status: "ok", data: SLIDES }, 1);
    expect(html).toContain("Simpanan");
    expect(html).toContain("Slide 2 dari 2");
  });

  it("renders the empty state (with the labelled heading) on ok + empty list", () => {
    const html = render({ status: "ok", data: [] });
    expect(html).toContain("Belum ada data di papan ini.");
    expect(html).toContain('id="mading-data-title"');
    expect(html).not.toContain('aria-roledescription="korsel"');
  });

  it("renders the offline fallback on degraded", () => {
    expect(render({ status: "degraded" })).toContain("Papan ini butuh koneksi internet.");
  });

  it("renders the error fallback on rpcError and invalid", () => {
    expect(render({ status: "rpcError", error: new Error("boom") })).toContain("Gagal memuat papan.");
    expect(render({ status: "invalid", raw: { nope: true } })).toContain("Gagal memuat papan.");
  });

  it("renders the loading state before the fetch resolves", () => {
    expect(render(null)).toContain("Memuat papan…");
  });
});
