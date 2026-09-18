import { describe, expect, it } from "vitest";
import { MAP_VIEW_FLY_MS, lerpMapDronePose, shouldAnimateMapViewFly } from "../mapViewFly";

describe("shouldAnimateMapViewFly", () => {
  it("flies between the three map poses", () => {
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "topdown" })
    ).toBe(true);
    expect(shouldAnimateMapViewFly({ prevViewMode: "topdown", nextViewMode: "route" })).toBe(
      true
    );
    expect(shouldAnimateMapViewFly({ prevViewMode: "route", nextViewMode: "drive" })).toBe(
      true
    );
    expect(shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "route" })).toBe(
      true
    );
    expect(MAP_VIEW_FLY_MS).toBeLessThan(1400);
    expect(MAP_VIEW_FLY_MS).toBeGreaterThan(500);
  });

  it("jumps on first paint, same view, pinch, dest-hold, or compare", () => {
    expect(shouldAnimateMapViewFly({ prevViewMode: null, nextViewMode: "drive" })).toBe(false);
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "drive" })
    ).toBe(false);
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "route",
        userExploring: true,
      })
    ).toBe(false);
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "route",
        destPlaceHold: true,
      })
    ).toBe(false);
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "topdown",
        offRouteCompare: true,
      })
    ).toBe(false);
  });
});

describe("lerpMapDronePose", () => {
  const pad = { top: 0, bottom: 0, left: 0, right: 0 };
  const from = {
    lng: -90,
    lat: 38,
    zoom: 16,
    pitch: 68,
    bearing: 350,
    padding: pad,
    offset: [0, 120] as [number, number],
  };
  const to = {
    lng: -90.2,
    lat: 38.2,
    zoom: 8,
    pitch: 0,
    bearing: 10,
    padding: pad,
    offset: [0, 0] as [number, number],
  };

  it("does not reverse zoom (no flyTo zoom-out-then-in)", () => {
    const a = lerpMapDronePose(from, to, 0.25);
    const b = lerpMapDronePose(from, to, 0.5);
    const c = lerpMapDronePose(from, to, 0.75);
    expect(a.zoom).toBeLessThan(from.zoom);
    expect(b.zoom).toBeLessThan(a.zoom);
    expect(c.zoom).toBeLessThan(b.zoom);
    expect(c.zoom).toBeGreaterThan(to.zoom);
  });

  it("takes the short bearing turn", () => {
    const mid = lerpMapDronePose(from, to, 0.5);
    expect(mid.bearing).toBeCloseTo(0, 5);
  });
});
