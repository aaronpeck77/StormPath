import { describe, expect, it } from "vitest";
import {
  destTapStartFromTouchCount,
  isDestFingerTap,
  shouldAcceptDestTap,
} from "../mapDestTap";

describe("mapDestTap", () => {
  it("ignores pinch (two fingers) as a dest tap", () => {
    expect(destTapStartFromTouchCount(2, { x: 10, y: 10 }, 0)).toBeNull();
    expect(
      isDestFingerTap({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 80 }, 1)
    ).toBe(false);
  });

  it("accepts a still one-finger tap", () => {
    const start = destTapStartFromTouchCount(1, { x: 40, y: 80 }, 1000);
    expect(start).toEqual({ x: 40, y: 80, t: 1000 });
    expect(isDestFingerTap(start, { x: 42, y: 81, t: 1180 }, 0)).toBe(true);
  });

  it("rejects a pan and a slow press", () => {
    const start = { x: 40, y: 80, t: 0 };
    expect(isDestFingerTap(start, { x: 80, y: 80, t: 120 }, 0)).toBe(false);
    expect(isDestFingerTap(start, { x: 40, y: 80, t: 800 }, 0)).toBe(false);
  });

  it("debounces click + touchend so dest is not placed twice", () => {
    expect(shouldAcceptDestTap(1000, 1200)).toBe(false);
    expect(shouldAcceptDestTap(1000, 1500)).toBe(true);
  });
});
