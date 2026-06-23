import { describe, expect, it } from "vitest";
import {
  DRIVE_LINE_AHEAD_M,
  DRIVE_LINE_BEHIND_M,
  normalizeStoredRouteGeometry,
  polylineLengthMeters,
  routeLineGeometryForDriveDisplay,
  ROUTE_GEOMETRY_STORAGE_VERTICES_EXTREME,
  ROUTE_GEOMETRY_STORAGE_VERTICES_LONG,
  ROUTE_GEOMETRY_STORAGE_VERTICES_ULTRA,
} from "../routeGeometry";
import {
  EXTREME_TRIP_ROUTE_M,
  isLongTripRoute,
  isUltraLongTripRoute,
  LONG_TRIP_ROUTE_M,
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

/** Dense polyline with approximate target length in meters (north-only segments). */
function routeWithLengthM(targetM: number, vertexCount: number): LngLat[] {
  const out: LngLat[] = [[-96, 41]];
  const segM = targetM / Math.max(1, vertexCount - 1);
  const latStep = segM / 111_320;
  for (let i = 1; i < vertexCount; i++) {
    const prev = out[out.length - 1]!;
    out.push([prev[0], prev[1] + latStep]);
  }
  return out;
}

describe("ultra-long route geometry", () => {
  it("detects ultra-long threshold near 300 mi", () => {
    expect(isUltraLongTripRoute(ULTRA_LONG_TRIP_ROUTE_M - 1)).toBe(false);
    expect(isUltraLongTripRoute(ULTRA_LONG_TRIP_ROUTE_M)).toBe(true);
  });

  it("caps stored geometry vertices on ultra-long routes", () => {
    const raw = longTestRoute(8_000);
    expect(polylineLengthMeters(raw)).toBeGreaterThan(ULTRA_LONG_TRIP_ROUTE_M);
    const stored = normalizeStoredRouteGeometry(raw);
    expect(stored.length).toBeLessThanOrEqual(ROUTE_GEOMETRY_STORAGE_VERTICES_ULTRA);
    expect(stored.length).toBeGreaterThan(10);
    expect(stored[0]).toEqual(raw[0]);
    expect(stored.at(-1)).toEqual(raw.at(-1));
  });

  it("caps stored geometry on 100+ mi long trips", () => {
    const raw = routeWithLengthM(LONG_TRIP_ROUTE_M + 50_000, 6_000);
    expect(isLongTripRoute(polylineLengthMeters(raw))).toBe(true);
    expect(isUltraLongTripRoute(polylineLengthMeters(raw))).toBe(false);
    const stored = normalizeStoredRouteGeometry(raw);
    expect(stored.length).toBeLessThanOrEqual(ROUTE_GEOMETRY_STORAGE_VERTICES_LONG);
    expect(stored.length).toBeGreaterThan(10);
  });

  it("uses highest storage cap on extreme trips", () => {
    const raw = routeWithLengthM(EXTREME_TRIP_ROUTE_M + 100_000, 20_000);
    const stored = normalizeStoredRouteGeometry(raw);
    expect(stored.length).toBeLessThanOrEqual(ROUTE_GEOMETRY_STORAGE_VERTICES_EXTREME);
    expect(stored.length).toBeGreaterThan(ROUTE_GEOMETRY_STORAGE_VERTICES_ULTRA);
  }, 20_000);

  it("leaves short routes untouched", () => {
    const short: LngLat[] = [
      [-87.62, 41.88],
      [-87.5, 41.9],
      [-87.4, 41.92],
    ];
    expect(normalizeStoredRouteGeometry(short)).toEqual(short);
  });

  it("limits drive line ahead window on long trips", () => {
    const totalM = LONG_TRIP_ROUTE_M + 200_000;
    const geometry = routeWithLengthM(totalM, 12_000);
    const userAlongM = totalM * 0.4;
    const slice = routeLineGeometryForDriveDisplay(geometry, userAlongM);
    const sliceLen = polylineLengthMeters(slice);
    const maxAhead = DRIVE_LINE_AHEAD_M + DRIVE_LINE_BEHIND_M + 5000;
    expect(sliceLen).toBeLessThan(totalM * 0.5);
    expect(sliceLen).toBeLessThanOrEqual(maxAhead);
    expect(sliceLen).toBeGreaterThan(DRIVE_LINE_AHEAD_M * 0.5);
  });

  it("draws full remaining leg on short trips", () => {
    const geometry: LngLat[] = [
      [-87.62, 41.88],
      [-87.5, 41.9],
      [-87.4, 41.92],
      [-87.3, 41.94],
    ];
    const totalM = polylineLengthMeters(geometry);
    const userAlongM = totalM * 0.25;
    const slice = routeLineGeometryForDriveDisplay(geometry, userAlongM);
    expect(polylineLengthMeters(slice)).toBeCloseTo(totalM - userAlongM + DRIVE_LINE_BEHIND_M, -1);
  });
});
