import { describe, expect, it } from "vitest";
import {
  lerpRadarSliceSamples,
  pickEvenSpacedItems,
  radarMapSliceHex,
  radarRailSliceGradientCss,
  radarSliceAtLoopT,
  RADAR_RAIL_LOOP_MS,
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

describe("radarSliceAtLoopT", () => {
  const a = [{ t: 0.3, intensity: 0.2 }];
  const b = [{ t: 0.5, intensity: 0.8 }];

  it("lerps the cell along the corridor between mosaic frames", () => {
    const mid = lerpRadarSliceSamples(a, b, 0.5);
    const at03 = mid.find((s) => s.t === 0.3);
    const at05 = mid.find((s) => s.t === 0.5);
    expect(at03?.intensity).toBeCloseTo(0.5, 5);
    expect(at05?.intensity).toBeCloseTo(0.5, 5);
  });

  it("plays the loop from first frame to last", () => {
    expect(radarSliceAtLoopT([a, b], 0)?.find((s) => s.t === 0.3)?.intensity).toBeCloseTo(0.2);
    expect(radarSliceAtLoopT([a, b], 0.999)?.find((s) => s.t === 0.5)?.intensity).toBeCloseTo(
      0.8,
      1
    );
    const mid = radarSliceAtLoopT([a, b], 0.5);
    expect(mid?.some((s) => s.t === 0.3 || s.t === 0.5)).toBe(true);
  });

  it("keeps first and last when capping frames", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(pickEvenSpacedItems(items, 5)).toEqual([0, 2, 5, 7, 9]);
  });

  it("plays slower than the map overlay so the colors stay readable", () => {
    expect(RADAR_RAIL_LOOP_MS).toBeGreaterThan(4500);
    expect(RADAR_RAIL_LOOP_MS).toBeLessThan(8000);
  });
});
