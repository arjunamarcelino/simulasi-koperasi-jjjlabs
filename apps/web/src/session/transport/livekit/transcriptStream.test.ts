import { describe, expect, it } from "vitest";
import { readTranscriptStream } from "./transcriptStream";

async function* chunks(...parts: string[]): AsyncIterable<string> {
  for (const p of parts) yield p;
}

describe("readTranscriptStream", () => {
  it("accumulates deltas and closes with a final line", async () => {
    const seen: [string, boolean][] = [];
    await readTranscriptStream(chunks("Pimpinan,", " saya", " tidak setuju!"), (t, f) =>
      seen.push([t, f]),
    );
    expect(seen).toEqual([
      ["Pimpinan,", false],
      ["Pimpinan, saya", false],
      ["Pimpinan, saya tidak setuju!", false],
      ["Pimpinan, saya tidak setuju!", true],
    ]);
  });

  it("still emits a final (empty) line for a stream with no chunks", async () => {
    const seen: [string, boolean][] = [];
    await readTranscriptStream(chunks(), (t, f) => seen.push([t, f]));
    expect(seen).toEqual([["", true]]);
  });
});
