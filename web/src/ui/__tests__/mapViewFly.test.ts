import { describe, expect, it } from "vitest";
import {
  MAP_VIEW_DESCEND_MS,
  MAP_VIEW_FLY_MS,
  lerpDescendOntoDrive,
  lerpMapDronePose,
  lockDescendStartToPuck,
  shouldAnimateMapViewFly,
  shouldDescendOntoDrive,
} from "../mapViewFly";

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

describe("lerpDescendOntoDrive", () => {
  const pad = { top: 0, bottom: 0, left: 0, right: 0 };
  const from = {
    lng: -90,
    lat: 38,
    zoom: 7.5,
    pitch: 0,
    bearing: 0,
    padding: pad,
    offset: [0, 0] as [number, number],
  };
  const to = {
    lng: -90.4,
    lat: 38.5,
    zoom: 16.6,
    pitch: 68,
    bearing: 90,
    padding: { top: 172, bottom: 156, left: 104, right: 104 },
    offset: [0, 220] as [number, number],
  };

  it("uses the descend path for overview → Drive", () => {
    expect(shouldDescendOntoDrive(from, to)).toBe(true);
    expect(shouldDescendOntoDrive(to, from)).toBe(false);
    expect(MAP_VIEW_DESCEND_MS).toBeGreaterThan(MAP_VIEW_FLY_MS);
  });

  it("never leaves the puck — center is the Drive target the whole dive", () => {
    const start = lockDescendStartToPuck(from, to);
    expect(start.lng).toBe(to.lng);
    expect(start.lat).toBe(to.lat);
    expect(start.zoom).toBe(from.zoom);
    for (const u of [0, 0.2, 0.45, 0.7, 1]) {
      const pose = lerpDescendOntoDrive(start, to, u);
      expect(pose.lng).toBe(to.lng);
      expect(pose.lat).toBe(to.lat);
    }
  });

  it("hovers then zooms down before pitching behind the puck", () => {
    const start = lockDescendStartToPuck(from, to);
    const hover = lerpDescendOntoDrive(start, to, 0.08);
    expect(hover.zoom).toBeCloseTo(from.zoom, 1);
    expect(hover.pitch).toBeLessThan(4);
    const mid = lerpDescendOntoDrive(start, to, 0.5);
    expect(mid.zoom).toBeGreaterThan((from.zoom + to.zoom) / 2);
    expect(mid.pitch).toBeLessThan(12);
    const late = lerpDescendOntoDrive(start, to, 0.92);
    expect(late.pitch).toBeGreaterThan(to.pitch * 0.7);
    expect(late.zoom).toBeGreaterThan(to.zoom - 0.8);
  });
});
