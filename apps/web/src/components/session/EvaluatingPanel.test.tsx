import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvaluatingPanel } from "./EvaluatingPanel";

// Shown from the moment the player ends a scenario until the auditor's result arrives, so
// the wait reads as "being assessed" rather than a frozen screen. Node env, no DOM.

describe("EvaluatingPanel", () => {
  it("tells the player the session is being assessed", () => {
    const html = renderToStaticMarkup(<EvaluatingPanel />);
    expect(html).toContain("Sedang menyusun evaluasi…");
    expect(html).toContain("Sesi Anda sedang dinilai");
  });

  it("announces itself to assistive tech", () => {
    expect(renderToStaticMarkup(<EvaluatingPanel />)).toContain('role="status"');
  });
});
