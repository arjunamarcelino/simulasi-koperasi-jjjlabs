import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MadingKnowledgeBoardBody } from "./MadingKnowledgeBoard";
import type { Keyed, RepoResult } from "../../lib/madingRepo";
import type { KnowledgeCard } from "../../lib/mading.types";

// The container owns the store gate + fetch + arrow handler; the pure body renders the carousel
// markup, so the APG ARIA is assertable without a DOM. renderToStaticMarkup keeps this in the
// repo's node test env (no jsdom). Listener scoping is verified manually (keyboard + SR at 360px).

const CARDS: Keyed<KnowledgeCard>[] = [
  { block_key: "k1", payload: { kind: "stat", value: "12.345", label: "unit aktif", group: "Nasional" } },
  { block_key: "k2", payload: { kind: "fact", text: "Koperasi pertama berdiri 1895.", chip: "Landasan Hukum" } },
];

const render = (result: RepoResult<Keyed<KnowledgeCard>[]> | null, idx = 0) =>
  renderToStaticMarkup(<MadingKnowledgeBoardBody result={result} idx={idx} onSelect={() => {}} />);

describe("MadingKnowledgeBoardBody", () => {
  it("exposes APG carousel + slide roles on ok", () => {
    const html = render({ status: "ok", data: CARDS });
    expect(html).toContain('aria-roledescription="korsel"');
    expect(html).toContain('aria-label="Pengetahuan Koperasi"');
    expect(html).toContain('aria-roledescription="salindia"');
  });

  it("names the stat slide from its content (no title field) and counts position", () => {
    const html = render({ status: "ok", data: CARDS }, 0);
    expect(html).toContain('aria-label="Nasional: 12.345 — unit aktif"');
    expect(html).toContain("Kartu 1 dari 2");
  });

  it("names the fact slide from its chip + text and renders that card at idx 1", () => {
    const html = render({ status: "ok", data: CARDS }, 1);
    expect(html).toContain('aria-label="Landasan Hukum: Koperasi pertama berdiri 1895."');
    expect(html).toContain("Koperasi pertama berdiri 1895.");
    expect(html).toContain("Kartu 2 dari 2");
  });

  it("wraps the dot row (no 360px overflow) and marks the active dot", () => {
    const html = render({ status: "ok", data: CARDS }, 0);
    expect(html).toContain("flex flex-wrap");
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
  });

  it("guards the fade node against reduced motion", () => {
    const html = render({ status: "ok", data: CARDS });
    expect(html).toContain("motion-reduce:animate-none");
  });

  it("renders the empty state on ok + empty list", () => {
    const html = render({ status: "ok", data: [] });
    expect(html).toContain("Belum ada kartu di papan ini.");
    expect(html).not.toContain('aria-roledescription="korsel"');
  });

  it("renders the offline fallback on degraded", () => {
    const html = render({ status: "degraded" });
    expect(html).toContain("Papan ini butuh koneksi internet.");
  });

  it("renders the error fallback on rpcError and invalid", () => {
    expect(render({ status: "rpcError", error: new Error("boom") })).toContain("Gagal memuat papan.");
    expect(render({ status: "invalid", raw: { nope: true } })).toContain("Gagal memuat papan.");
  });

  it("renders the loading state before the fetch resolves", () => {
    expect(render(null)).toContain("Memuat papan…");
  });
});
