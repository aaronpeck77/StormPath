import { describe, expect, it } from "vitest";
import { TOPDOWN_NAV_STREET_ZOOM, topdownZoomOnEnter } from "../mapTopdownCamera";

describe("topdownZoomOnEnter", () => {
  it("pulls a Drive frame back a couple steps and does not pull twice", () => {
    const stored = { current: 16 };
    expect(topdownZoomOnEnter(16.6, stored)).toBeCloseTo(15.1, 5);
    expect(topdownZoomOnEnter(16.6, stored)).toBeCloseTo(15.1, 5);
  });

  it("pulls the highway Drive frame back the same amount", () => {
    const stored = { current: 16 };
    expect(topdownZoomOnEnter(15.35, stored)).toBeCloseTo(13.85, 5);
  });

  it("snaps a Route overview up to the Mp street zoom", () => {
    const stored = { current: 7 };
    expect(topdownZoomOnEnter(6.9, stored)).toBe(TOPDOWN_NAV_STREET_ZOOM);
  });
});
