import { describe, expect, it } from "vitest";
import { buildNativeGuidanceCoordinates } from "../nativeGuidanceCoords";
import { polylineLengthMeters } from "../routeGeometry";
import type { LngLat } from "../types";

describe("buildNativeGuidanceCoordinates", () => {
  const corridor: LngLat[] = [
    [-86.78, 36.16],
    [-86.79, 36.17],
    [-86.8, 36.18],
    [-86.81, 36.19],
    [-86.82, 36.2],
  ];

  it("prefers the Go-locked corridor over bare origin→dest", () => {
    const coords = buildNativeGuidanceCoordinates({
      userLngLat: [-86.5, 36.0],
      viaStops: [],
      destLngLat: [-86.9, 36.3],
      lockedCorridor: corridor,
      maxCoords: 4,
    });
    expect(coords).not.toBeNull();
    expect(coords!.length).toBeGreaterThanOrEqual(2);
    expect(coords![0]).toEqual({ lng: -86.5, lat: 36.0 });
    expect(coords![coords!.length - 1]).toEqual({ lng: -86.82, lat: 36.2 });
  });

  it("starts Core from the remaining corridor near GPS, not the original origin", () => {
    const long: LngLat[] = [];
    for (let i = 0; i <= 20; i++) {
      long.push([-86.78, 36.16 + i * 0.01]);
    }
    const user: LngLat = [-86.78, 36.26];
    const coords = buildNativeGuidanceCoordinates({
      userLngLat: user,
      viaStops: [],
      destLngLat: long[long.length - 1]!,
      lockedCorridor: long,
      maxCoords: 8,
    });
    expect(coords).not.toBeNull();
    expect(coords![0]).toEqual({ lng: user[0], lat: user[1] });
    expect(coords![coords!.length - 1]!.lat).toBeCloseTo(36.36, 2);
    /* Must not still be pinned at the plan origin miles behind the puck. */
    expect(coords!.some((c) => c.lat < 36.2)).toBe(false);
  });

  it("shapes a long corridor with a few silent points, not a dense 25-sample", () => {
    const long: LngLat[] = [];
    for (let i = 0; i <= 200; i++) {
      long.push([-86.78 + i * 0.02, 36.16]);
    }
    expect(polylineLengthMeters(long)).toBeGreaterThan(50_000);
    const coords = buildNativeGuidanceCoordinates({
      userLngLat: long[0]!,
      viaStops: [],
      destLngLat: long[long.length - 1]!,
      lockedCorridor: long,
      maxCoords: 16,
    });
    expect(coords).not.toBeNull();
    expect(coords!.length).toBeGreaterThan(2);
    expect(coords!.length).toBeLessThanOrEqual(16);
    expect(coords!.filter((c) => c.separatesLegs === false).length).toBeGreaterThan(0);
    expect(coords!.length).toBeLessThan(long.length / 8);
  });

  it("marks real vias as stop legs", () => {
    const coords = buildNativeGuidanceCoordinates({
      userLngLat: [-86.78, 36.16],
      viaStops: [{ lngLat: [-86.8, 36.18], label: "Stop" }],
      destLngLat: [-86.82, 36.2],
    });
    expect(coords?.some((c) => c.separatesLegs === true && c.lng === -86.8)).toBe(true);
  });

  it("falls back to origin → vias → dest when no corridor", () => {
    const coords = buildNativeGuidanceCoordinates({
      userLngLat: [-86.78, 36.16],
      viaStops: [{ lngLat: [-86.8, 36.18], label: "Stop" }],
      destLngLat: [-86.82, 36.2],
    });
    expect(coords?.map((c) => [c.lng, c.lat])).toEqual([
      [-86.78, 36.16],
      [-86.8, 36.18],
      [-86.82, 36.2],
    ]);
  });
});
