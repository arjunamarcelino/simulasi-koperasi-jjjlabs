import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EvidenceContent } from "../../types/scenario";
import { EvidenceDossier, EvidencePanel } from "./EvidencePanel";

// The case file the player opens from the rail ("Periksa Bukti"/"Periksa Dokumen").
// With a guide it also tells the player what to look for, so the file explains the
// conversation instead of being a bare table. Node env, no DOM.

const FILE: EvidenceContent = {
  title: "Periksa Bukti",
  eyebrow: "BERKAS PERKARA — Pak Joko",
  items: [
    { label: "Tunggakan", value: "2 bulan (Mei, Jun)", tone: "bad" },
    { label: "Riwayat Bayar", value: "Lancar 10 bulan pertama", tone: "good" },
  ],
};

const GUIDED: EvidenceContent = {
  ...FILE,
  guide: {
    callout: "Mulai dari sini: buka berkas Pak Joko",
    nudge: "Buka 'Periksa Bukti' dulu.",
    lookFor: ["Tanyakan apa yang berubah sejak Mei.", "Gali sebabnya langsung."],
  },
};

describe("EvidenceDossier", () => {
  it("renders the file's framing and rows", () => {
    const html = renderToStaticMarkup(<EvidenceDossier evidence={FILE} />);
    expect(html).toContain("BERKAS PERKARA — Pak Joko");
    expect(html).toContain("Periksa Bukti");
    expect(html).toContain("Tunggakan");
    expect(html).toContain("2 bulan (Mei, Jun)");
  });

  it("tells the player what to look for when the file has a guide", () => {
    const html = renderToStaticMarkup(<EvidenceDossier evidence={GUIDED} />);
    expect(html).toContain("Yang perlu kamu perhatikan");
    expect(html).toContain("Tanyakan apa yang berubah sejak Mei.");
    expect(html).toContain("Gali sebabnya langsung.");
  });

  it("shows no reading guide for a file without one", () => {
    const html = renderToStaticMarkup(<EvidenceDossier evidence={FILE} />);
    expect(html).not.toContain("Yang perlu kamu perhatikan");
  });
});

describe("EvidencePanel", () => {
  it("wraps the dossier with a close button", () => {
    const html = renderToStaticMarkup(<EvidencePanel evidence={GUIDED} onClose={() => {}} />);
    expect(html).toContain('aria-label="Tutup bukti"');
    expect(html).toContain("Yang perlu kamu perhatikan");
  });
});
