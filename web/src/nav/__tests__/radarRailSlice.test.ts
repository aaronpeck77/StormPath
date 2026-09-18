import { describe, expect, it } from "vitest";
import {
  radarMapSliceHex,
  radarRailSliceGradientCss,
  RADAR_SLICE_MIN_RAW,
} from "../radarRailSlice";

describe("radarMapSliceHex", () => {
  it("stays clear when the mosaic pixel is empty", () => {
    expect(radarMapSliceHex(0)).toBeNull();
    expect(radarMapSliceHex(RADAR_SLICE_MIN_RAW - 0.01)).toBeNull();
  });

  it("uses map colors: green → yellow → red", () => {
    expect(radarMapSliceHex(0.15)).toBe("#22c55e");
    expect(radarMapSliceHex(0.45)).toBe("#facc15");
    expect(radarMapSliceHex(0.75)).toBe("#ef4444");
  });
});

describe("radarRailSliceGradientCss", () => {
  it("returns null when nothing crosses the corridor", () => {
    expect(radarRailSliceGradientCss([])).toBeNull();
    expect(radarRailSliceGradientCss([{ t: 0.4, intensity: 0.02 }])).toBeNull();
  });

  it("places a red stop where the cell crosses, not a padded mile", () => {
    const css = radarRailSliceGradientCss([
      { t: 0.2, intensity: 0.02 },
      { t: 0.55, intensity: 0.8 },
      { t: 0.9, intensity: 0.01 },
    ]);
    expect(css).toContain("linear-gradient(90deg");
    expect(css).toContain("#ef4444");
    expect(css).toContain("55.0%");
    expect(css).toContain("transparent");
  });
});
