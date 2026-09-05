import { describe, expect, it } from "vitest";
import {
  RADAR_ANIMATION_FRAME_MS_MAX,
  RADAR_ANIMATION_FRAME_MS_MIN,
  RADAR_ANIMATION_LOOP_MS,
  radarAnimationCrossfadeMs,
  radarCrossfadeProgress,
  snapRainViewerRadarToSolidFrame,
  RAINVIEWER_RADAR_VISIBLE_OPACITY,
} from "../mapRadarLayer";

describe("radarAnimationCrossfadeMs", () => {
  it("targets ~3.6s for a typical 12-frame pack", () => {
    const ms = radarAnimationCrossfadeMs(12);
    expect(ms).toBe(Math.round(RADAR_ANIMATION_LOOP_MS / 12));
    expect(ms * 12).toBe(RADAR_ANIMATION_LOOP_MS);
  });

  it("clamps sparse and dense packs", () => {
    expect(radarAnimationCrossfadeMs(2)).toBe(RADAR_ANIMATION_FRAME_MS_MAX);
    expect(radarAnimationCrossfadeMs(40)).toBe(RADAR_ANIMATION_FRAME_MS_MIN);
  });
});

describe("radarCrossfadeProgress", () => {
  it("eases gently at the ends", () => {
    expect(radarCrossfadeProgress(0)).toBe(0);
    expect(radarCrossfadeProgress(1)).toBe(1);
    expect(radarCrossfadeProgress(0.5)).toBeCloseTo(0.5, 5);
    /* Early progress slower than linear; late progress catches up. */
    expect(radarCrossfadeProgress(0.25)).toBeLessThan(0.25);
    expect(radarCrossfadeProgress(0.75)).toBeGreaterThan(0.75);
  });
});

describe("snapRainViewerRadarToSolidFrame", () => {
  it("keeps the stronger buffer and forces layers visible", () => {
    const opacity = new Map<string, number>([
      ["rainviewer-radar-layer-a", 0.2],
      ["rainviewer-radar-layer-b", 0.5],
    ]);
    const visibility = new Map<string, string>();
    const map = {
      getLayer: (id: string) => (opacity.has(id) ? { id } : undefined),
      getPaintProperty: (id: string, key: string) =>
        key === "raster-opacity" ? opacity.get(id) : undefined,
      setPaintProperty: (id: string, key: string, value: unknown) => {
        if (key === "raster-opacity") opacity.set(id, value as number);
      },
      setLayoutProperty: (id: string, key: string, value: unknown) => {
        if (key === "visibility") visibility.set(id, value as string);
      },
    };
    snapRainViewerRadarToSolidFrame(map as never, RAINVIEWER_RADAR_VISIBLE_OPACITY);
    expect(opacity.get("rainviewer-radar-layer-a")).toBe(0);
    expect(opacity.get("rainviewer-radar-layer-b")).toBe(RAINVIEWER_RADAR_VISIBLE_OPACITY);
    expect(visibility.get("rainviewer-radar-layer-a")).toBe("visible");
    expect(visibility.get("rainviewer-radar-layer-b")).toBe("visible");
  });
});
