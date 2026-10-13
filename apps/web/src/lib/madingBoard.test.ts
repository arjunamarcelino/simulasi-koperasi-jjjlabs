import { describe, expect, it } from "vitest";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { carouselArrowIndex, wrapIndex } from "./madingBoard";

// carouselArrowIndex centralizes the arrow-nav decision shared by both mading carousels. The
// editable-target guard needs a DOM, so these cover the DOM-independent paths (the typeof guard in
// the helper keeps it callable here); full listener scoping is verified manually at 360px.
const key = (over: Partial<ReactKeyboardEvent>): ReactKeyboardEvent =>
  ({ key: "ArrowRight", repeat: false, target: null, ...over }) as unknown as ReactKeyboardEvent;

describe("carouselArrowIndex", () => {
  it("steps right and left, wrapping at both ends", () => {
    expect(carouselArrowIndex(key({ key: "ArrowRight" }), 0, 3)).toBe(1);
    expect(carouselArrowIndex(key({ key: "ArrowRight" }), 2, 3)).toBe(0); // wraps forward
    expect(carouselArrowIndex(key({ key: "ArrowLeft" }), 0, 3)).toBe(2); // wraps backward
  });

  it("ignores non-arrow keys", () => {
    expect(carouselArrowIndex(key({ key: "Enter" }), 0, 3)).toBeNull();
    expect(carouselArrowIndex(key({ key: "a" }), 0, 3)).toBeNull();
  });

  it("ignores auto-repeat (a held key must not strobe the fade)", () => {
    expect(carouselArrowIndex(key({ key: "ArrowRight", repeat: true }), 0, 3)).toBeNull();
  });

  it("ignores arrows on an empty board (no preventDefault on loading/empty states)", () => {
    expect(carouselArrowIndex(key({ key: "ArrowRight" }), 0, 0)).toBeNull();
  });
});

describe("wrapIndex", () => {
  it("wraps into [0, len) and clamps len 0 to 0", () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(5, 0)).toBe(0);
  });
});
