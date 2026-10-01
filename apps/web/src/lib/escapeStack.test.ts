import { describe, expect, it, vi } from "vitest";
import { handleEscape, pushEscape } from "./escapeStack";

// Each test clears what it registers so the module-level slot stays clean between cases.
describe("escapeStack", () => {
  it("returns false when nothing is registered", () => {
    expect(handleEscape()).toBe(false);
  });

  it("runs the registered handler and consumes the Escape", () => {
    const fn = vi.fn();
    pushEscape(fn);
    expect(handleEscape()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clears the handler after firing so a second Escape falls through", () => {
    const fn = vi.fn();
    pushEscape(fn);
    expect(handleEscape()).toBe(true);
    expect(handleEscape()).toBe(false); // popped — modal would now handle Esc
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a later push replaces the earlier handler (single slot)", () => {
    const first = vi.fn();
    const second = vi.fn();
    pushEscape(first);
    const offSecond = pushEscape(second);
    expect(handleEscape()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    offSecond();
  });

  it("unsubscribe removes the handler so it never fires", () => {
    const fn = vi.fn();
    const off = pushEscape(fn);
    off();
    expect(handleEscape()).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
