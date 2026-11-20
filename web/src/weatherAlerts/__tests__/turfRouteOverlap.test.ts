import { describe, expect, it } from "vitest";
import {
  polylineIntersectsPolygon,
  polylineNearPolygon,
} from "../geometryOverlap";
import type { LngLat } from "../../nav/types";

/* Straight east-west route through Kansas, ~1° ≈ 88 km. */
const ROUTE: LngLat[] = [
  [-97.5, 38.0],
  [-96.5, 38.0],
];

/** Narrow diamond that clips the route's midpoint — no route vertex inside. */
const CLIP_POLY: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-97.0, 38.05],
      [-96.99, 38.0],
      [-97.0, 37.95],
      [-97.01, 38.0],
      [-97.0, 38.05],
    ],
  ],
};

/** Small polygon ~30 km north of the route midpoint. */
const NEAR_POLY: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-97.05, 38.28],
      [-96.95, 38.28],
      [-96.95, 38.22],
      [-97.05, 38.22],
      [-97.05, 38.28],
    ],
  ],
};

/** Small polygon ~120 km north — outside a 45 km corridor band. */
const FAR_POLY: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-97.05, 39.1],
      [-96.95, 39.1],
      [-96.95, 39.0],
      [-97.05, 39.0],
      [-97.05, 39.1],
    ],
  ],
};

describe("polylineIntersectsPolygon (turf exact)", () => {
  it("detects a polygon that clips the route between vertices", () => {
    /* Old vertex sampling could miss this: neither route endpoint is inside. */
    expect(polylineIntersectsPolygon(ROUTE, CLIP_POLY)).toBe(true);
  });

  it("rejects polygons that don't touch the route", () => {
    expect(polylineIntersectsPolygon(ROUTE, FAR_POLY)).toBe(false);
    expect(polylineIntersectsPolygon(ROUTE, NEAR_POLY)).toBe(false);
  });
});

describe("polylineNearPolygon (buffered corridor)", () => {
  it("counts a polygon within the buffer band", () => {
    expect(polylineNearPolygon(ROUTE, NEAR_POLY, 45_000)).toBe(true);
  });

  it("rejects a polygon beyond the band — true distance, not bbox", () => {
    expect(polylineNearPolygon(ROUTE, FAR_POLY, 45_000)).toBe(false);
  });
});
