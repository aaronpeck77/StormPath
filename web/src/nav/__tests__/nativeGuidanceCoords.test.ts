import { describe, expect, it } from "vitest";
import { buildNativeGuidanceCoordinates } from "../nativeGuidanceCoords";
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
    expect(coords![0]).toEqual({ lng: -86.78, lat: 36.16 });
    expect(coords![coords!.length - 1]).toEqual({ lng: -86.82, lat: 36.2 });
  });

  it("falls back to origin → vias → dest when no corridor", () => {
    const coords = buildNativeGuidanceCoordinates({
      userLngLat: [-86.78, 36.16],
      viaStops: [{ lngLat: [-86.8, 36.18], label: "Stop" }],
      destLngLat: [-86.82, 36.2],
    });
    expect(coords).toEqual([
      { lng: -86.78, lat: 36.16 },
      { lng: -86.8, lat: 36.18 },
      { lng: -86.82, lat: 36.2 },
    ]);
  });
});
