import { describe, expect, it } from "vitest";
import {
  CONTINENT_MAP_BOUNDS,
  mapMaxBoundsForLngLat,
  mapMinZoomForSession,
  padMapBounds,
} from "../mapRegion";

describe("mapRegion", () => {
  it("scopes a US fix to North America", () => {
    const b = mapMaxBoundsForLngLat([-89.6, 39.8]);
    const raw = CONTINENT_MAP_BOUNDS.NA;
    expect(b[0]![0]).toBeLessThan(raw[0]![0]!);
    expect(b[1]![0]).toBeGreaterThan(raw[1]![0]!);
  });

  it("scopes a UK fix to Europe", () => {
    const b = mapMaxBoundsForLngLat([-0.1, 51.5]);
    expect(b[0]![0]).toBeGreaterThan(-30);
    expect(b[1]![0]).toBeLessThan(65);
  });

  it("uses world bounds on unknown ocean cells", () => {
    expect(mapMaxBoundsForLngLat([0, 86])).toEqual([
      [-180, -85],
      [180, 85],
    ]);
  });

  it("lowers min zoom for ultra-long routes and cross-country navigation", () => {
    expect(
      mapMinZoomForSession({ navigationStarted: true, hasContinent: true, ultraLongRoute: true })
    ).toBe(2);
    expect(mapMinZoomForSession({ navigationStarted: true, hasContinent: true })).toBe(3);
    expect(mapMinZoomForSession({ navigationStarted: false, hasContinent: true })).toBe(3);
  });

  it("pads bounds within world limits", () => {
    const padded = padMapBounds([
      [-168, 7],
      [-52, 84],
    ]);
    expect(padded[0]![0]).toBe(-171);
    expect(padded[1]![1]).toBeLessThanOrEqual(85);
  });
});
