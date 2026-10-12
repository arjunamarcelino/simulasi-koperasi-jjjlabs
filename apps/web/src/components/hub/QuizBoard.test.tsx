import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuizErrorContent } from "./QuizBoard";

// QuizBoard is a stateful overlay; its branch matrix for the error/empty states lives in the pure
// QuizErrorContent, rendered without a DOM (node test env, no jsdom — matching the repo convention).
// SIM-18: the empty catalog is a DISTINCT terminal state, not a transient "retry" error.

const noop = () => {};
const render = (errorKind: "offline" | "retryable" | "empty") =>
  renderToStaticMarkup(<QuizErrorContent errorKind={errorKind} onRetry={noop} onClose={noop} />);

describe("QuizErrorContent", () => {
  it("empty catalog → distinct message, NO retry button", () => {
    const html = render("empty");
    expect(html).toContain("Belum ada soal kuis.");
    expect(html).not.toContain("Coba Lagi");
    expect(html).not.toContain("Gagal memuat"); // not conflated with a transient error
    expect(html).toContain("Tutup");
  });

  it("offline → connection message, NO retry button", () => {
    const html = render("offline");
    expect(html).toContain("Kuis butuh koneksi internet.");
    expect(html).not.toContain("Coba Lagi");
    expect(html).toContain("Tutup");
  });

  it("retryable → transient-error message WITH a retry button", () => {
    const html = render("retryable");
    expect(html).toContain("Gagal memuat kuis.");
    expect(html).toContain("Coba Lagi");
    expect(html).toContain("Tutup");
  });
});
