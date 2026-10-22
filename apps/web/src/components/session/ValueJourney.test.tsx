import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ValueJourney } from "./ValueJourney";
import { ResultPanel } from "./ResultPanel";
import type { AuditorResult } from "../../session/transport/contract";

// "Perjalanan Nilaimu": the personal, number-free part of the result. Rendered without a
// DOM (node test env, renderToStaticMarkup — matching the repo convention).

const VALUES: AuditorResult["values"] = {
  kepedulian: {
    status: "TERCERMIN",
    evidence: "Anda menanyakan riwayat pencatatan sebelum menyebut KOP-0161.",
    trend: "MENGUAT",
  },
  kejujuran: {
    status: "TERCERMIN",
    evidence: "Anda tetap menyebut baris tanpa NIK.",
    trend: "BARU_DIUJI",
  },
};

const render = (o: Partial<Pick<AuditorResult, "values" | "progressFeedback" | "nextStep">> = {}) =>
  renderToStaticMarkup(
    <ValueJourney
      values={VALUES}
      progressFeedback="Saran sesi lalu Anda jalankan."
      nextStep="Tetap santun saat ditekan."
      {...o}
    />,
  );

describe("ValueJourney", () => {
  it("shows the narrative, each value with its trend AND its evidence, then the next step", () => {
    const html = render();
    expect(html).toContain("PERJALANAN NILAIMU");
    expect(html).toContain("Saran sesi lalu Anda jalankan.");
    expect(html).toContain("Kepedulian terhadap Sesama");
    expect(html).toContain("▲ menguat");
    expect(html).toContain("Anda menanyakan riwayat pencatatan sebelum menyebut KOP-0161.");
    expect(html).toContain("○ baru diuji · tercermin");
    expect(html).toContain("Coba di sesi berikutnya");
    expect(html).toContain("Tetap santun saat ditekan.");
  });

  it("never renders a numeric score", () => {
    expect(render()).not.toMatch(/\d+\s*\/\s*100|>\d{1,3}</);
  });

  it("renders nothing for a tutorial / failed audit (no values, no narrative)", () => {
    expect(render({ values: {}, progressFeedback: "", nextStep: "" })).toBe("");
  });

  it("omits the next-step line when there is no suggestion", () => {
    expect(render({ nextStep: "" })).not.toContain("Coba di sesi berikutnya");
  });
});

describe("ResultPanel + ValueJourney", () => {
  const result: AuditorResult = {
    scenarioId: "keanggotaan-fiktif",
    trigger: "manual",
    stateClassification: { State_Relasi_NPC: "TERJAGA" },
    scores: { integritas_data: 80 },
    endingType: "good",
    narrativeFeedback: "Narasi sesi.",
    values: VALUES,
    progressFeedback: "Saran sesi lalu Anda jalankan.",
    nextStep: "Tetap santun saat ditekan.",
    evaluationFailed: false,
  };
  const panel = (r: AuditorResult) =>
    renderToStaticMarkup(<ResultPanel ended={{ trigger: "manual", result: r }} onBack={() => {}} />);

  it("adds the journey after the session narrative", () => {
    const html = panel(result);
    expect(html.indexOf("Narasi sesi.")).toBeLessThan(html.indexOf("PERJALANAN NILAIMU"));
  });

  it("keeps the tutorial result unchanged (no journey section)", () => {
    const html = panel({ ...result, values: {}, progressFeedback: "", nextStep: "" });
    expect(html).not.toContain("PERJALANAN NILAIMU");
  });
});
