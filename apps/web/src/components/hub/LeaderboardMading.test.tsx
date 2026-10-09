import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardMadingBody } from "./LeaderboardMading";
import type { LeaderboardRow, RepoResult } from "../../lib/leaderboardRepo";

// The container owns a store gate + async fetch; the branching matrix lives in the pure
// LeaderboardMadingBody, which renders without a DOM. renderToStaticMarkup keeps this in
// the repo's node test env (no jsdom), covering every RepoResult variant + loading.

const render = (result: RepoResult<LeaderboardRow[]> | null) =>
  renderToStaticMarkup(<LeaderboardMadingBody result={result} />);

describe("LeaderboardMadingBody", () => {
  it("renders ranked rows on ok (rank / name / xp / level)", () => {
    const html = render({
      status: "ok",
      data: [
        { display_name: "Budi", xp: 120, level: 3, rank: 1 },
        { display_name: "Siti", xp: 80, level: 2, rank: 2 },
      ],
    });
    expect(html).toContain("Budi");
    expect(html).toContain("Siti");
    expect(html).toContain("120");
    expect(html).toContain("Anggota"); // XP column header for members
    expect(html).toContain("Level");
    expect(html).not.toContain("Papan musim belum tersedia");
  });

  it("renders the empty state on ok + empty array", () => {
    const html = render({ status: "ok", data: [] });
    expect(html).toContain("Papan musim belum tersedia");
  });

  it("renders an offline notice on degraded (distinct from the empty state)", () => {
    const html = render({ status: "degraded" });
    expect(html).toContain("luring");
    expect(html).not.toContain("Papan musim belum tersedia");
  });

  it("renders an error fallback on rpcError", () => {
    const html = render({ status: "rpcError", error: new Error("boom") });
    expect(html).toContain("Gagal memuat");
  });

  it("renders an error fallback on invalid", () => {
    const html = render({ status: "invalid", raw: { nope: true } });
    expect(html).toContain("Gagal memuat");
  });

  it("renders a loading state before the fetch resolves", () => {
    const html = render(null);
    expect(html).toContain("Memuat");
  });
});
