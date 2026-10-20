import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionRail } from "./ActionRail";

// Until the player opens the case file, its rail button carries a mustard ring, a "!"
// badge and (when given) a coachmark bubble that opens the file. Node env, no DOM.

const base = {
  ready: true,
  endLabel: "Keputusan Akhir",
  hintLoading: false,
  phase: null,
  canEnd: true,
  hasEvidence: true,
  evidenceLabel: "Periksa Bukti",
  onHint: () => {},
  onToggleBriefing: () => {},
  onCheckEvidence: () => {},
  onAdvancePhase: () => {},
  onEnd: () => {},
};

const CALLOUT = "Mulai dari sini: buka berkas Pak Joko";

describe("ActionRail — open-the-file nudge", () => {
  it("rings the evidence button and shows the coachmark while nudging", () => {
    const html = renderToStaticMarkup(
      <ActionRail {...base} nudgeEvidence evidenceCallout={CALLOUT} />,
    );
    expect(html).toContain("guide-nudge");
    expect(html).toContain(CALLOUT);
    expect(html).toContain('data-testid="evidence-badge"');
  });

  it("can ring without a coachmark (e.g. while the briefing is open)", () => {
    const html = renderToStaticMarkup(
      <ActionRail {...base} nudgeEvidence evidenceCallout={null} />,
    );
    expect(html).toContain("guide-nudge");
    expect(html).not.toContain(CALLOUT);
  });

  it("is quiet once the file was opened", () => {
    const html = renderToStaticMarkup(<ActionRail {...base} evidenceCallout={null} />);
    expect(html).not.toContain("guide-nudge");
    expect(html).not.toContain('data-testid="evidence-badge"');
  });

  it("does not ring a disabled button", () => {
    const html = renderToStaticMarkup(
      <ActionRail {...base} ready={false} nudgeEvidence evidenceCallout={null} />,
    );
    expect(html).not.toContain("guide-nudge");
  });

  it("never nudges a scenario without evidence", () => {
    const html = renderToStaticMarkup(
      <ActionRail {...base} hasEvidence={false} nudgeEvidence evidenceCallout={CALLOUT} />,
    );
    expect(html).not.toContain("guide-nudge");
    expect(html).not.toContain(CALLOUT);
  });
});
