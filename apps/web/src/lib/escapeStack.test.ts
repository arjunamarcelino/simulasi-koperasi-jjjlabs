import { describe, expect, it, vi } from "vitest";
import { handleEscape, pushEscape } from "./escapeStack";

// Each test unsubscribes what it pushes so the module-level stack stays clean between cases.
describe("escapeStack", () => {
  it("returns false when nothing is registered", () => {
    expect(handleEscape()).toBe(false);
  });

  it("runs the topmost handler LIFO and reports consumption", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = pushEscape(first);
    const offSecond = pushEscape(second);

    expect(handleEscape()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    offSecond();
    offFirst();
  });

  it("unsubscribe removes a handler so it never fires", () => {
    const fn = vi.fn();
    const off = pushEscape(fn);
    off();
    expect(handleEscape()).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
