import { describe, expect, it } from "vitest";
import {
  normalizeStoredRouteGeometry,
  polylineLengthMeters,
  ROUTE_GEOMETRY_STORAGE_VERTICES_ULTRA,
} from "../routeGeometry";
import {
  isUltraLongTripRoute,
  ULTRA_LONG_TRIP_ROUTE_M,
} from "../../utils/dataSaver";
import type { LngLat } from "../types";

/** Synthetic cross-country-ish polyline (~350+ mi). */
function longTestRoute(vertexCount: number): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const t = i / Math.max(1, vertexCount - 1);
    out.push([-96 + t * 18, 41 - t * 8]);
  }
  return out;
}

describe("ultra-long route geometry", () => {
  it("detects ultra-long threshold near 300 mi", () => {
    expect(isUltraLongTripRoute(ULTRA_LONG_TRIP_ROUTE_M - 1)).toBe(false);
    expect(isUltraLongTripRoute(ULTRA_LONG_TRIP_ROUTE_M)).toBe(true);
  });

  it("caps stored geometry vertices on ultra-long routes", () => {
    const raw = longTestRoute(40_000);
    expect(polylineLengthMeters(raw)).toBeGreaterThan(ULTRA_LONG_TRIP_ROUTE_M);
    const stored = normalizeStoredRouteGeometry(raw);
    expect(stored.length).toBeLessThanOrEqual(ROUTE_GEOMETRY_STORAGE_VERTICES_ULTRA);
    expect(stored.length).toBeGreaterThan(10);
    expect(stored[0]).toEqual(raw[0]);
    expect(stored.at(-1)).toEqual(raw.at(-1));
  });

  it("leaves short routes untouched", () => {
    const short: LngLat[] = [
      [-87.62, 41.88],
      [-87.5, 41.9],
      [-87.4, 41.92],
    ];
    expect(normalizeStoredRouteGeometry(short)).toEqual(short);
  });
});
