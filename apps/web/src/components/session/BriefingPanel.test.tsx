import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScenarioConfig } from "../../types/scenario";
import { BriefingPanel } from "./BriefingPanel";

// The Deskripsi panel opens by default. For scenarios whose case lives in a file, the
// step naming that file carries an inline action to open it — the first, most visible
// pointer to the documents. Node env, no DOM.

const CONFIG: ScenarioConfig = {
  id: "kredit-macet",
  title: "Kredit Macet",
  shortDescription: "…",
  difficulty: "Menengah",
  status: "AVAILABLE",
  mission: "Selidiki alasan Pak Joko menunggak.",
  steps: ["Buka 'Periksa Bukti' dulu.", "Sapa Pak Joko dengan tenang."],
};

const action = (opened: boolean) => ({
  stepIndex: 0,
  label: "Periksa Bukti",
  opened,
  onOpen: () => {},
});

describe("BriefingPanel", () => {
  it("renders the mission and steps", () => {
    const html = renderToStaticMarkup(<BriefingPanel config={CONFIG} onClose={() => {}} />);
    expect(html).toContain("Kredit Macet");
    expect(html).toContain("Selidiki alasan Pak Joko menunggak.");
    expect(html).toContain("Sapa Pak Joko dengan tenang.");
  });

  it("has no open-file action without one", () => {
    const html = renderToStaticMarkup(<BriefingPanel config={CONFIG} onClose={() => {}} />);
    expect(html).not.toContain('aria-label="Buka Periksa Bukti"');
  });

  it("puts an open action on the step that names the file", () => {
    const html = renderToStaticMarkup(
      <BriefingPanel config={CONFIG} onClose={() => {}} evidenceAction={action(false)} />,
    );
    expect(html).toContain('aria-label="Buka Periksa Bukti"');
    expect(html).toContain("📁 Buka");
  });

  it("marks the step done once the file was opened (still reopenable)", () => {
    const html = renderToStaticMarkup(
      <BriefingPanel config={CONFIG} onClose={() => {}} evidenceAction={action(true)} />,
    );
    expect(html).toContain("✓ Diperiksa");
    expect(html).toContain('aria-label="Buka Periksa Bukti"');
    expect(html).not.toContain("📁 Buka");
  });
});
