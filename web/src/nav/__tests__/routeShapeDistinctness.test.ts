import { describe, expect, it } from "vitest";
import {
  routeCorridorOverlapFraction,
  routesEffectivelySame,
} from "../routeGeometry";
import type { LngLat } from "../types";

/** Simple north–south polyline in degrees (~11 km per 0.1° lat). */
function lineY(y0: number, y1: number, x = -90): LngLat[] {
  const out: LngLat[] = [];
  for (let y = y0; y <= y1; y += 0.02) out.push([x, y]);
  return out;
}

describe("routeCorridorOverlapFraction", () => {
  it("reports high overlap for the same corridor", () => {
    const a = lineY(38, 39);
    const b = lineY(38, 39.01);
    expect(routeCorridorOverlapFraction(a, b)).toBeGreaterThan(0.9);
    expect(routesEffectivelySame(a, b)).toBe(true);
  });

  it("allows partial overlap when legs diverge mid-route", () => {
    const shared = lineY(38, 38.5);
    const a: LngLat[] = [...shared, ...lineY(38.52, 39, -90)];
    const b: LngLat[] = [...shared, ...lineY(38.52, 39, -90.35)];
    const overlap = routeCorridorOverlapFraction(a, b);
    expect(overlap).toBeGreaterThan(0.35);
    expect(overlap).toBeLessThan(0.88);
    expect(routesEffectivelySame(a, b)).toBe(false);
  });

  it("reports low overlap for clearly different corridors", () => {
    const a = lineY(38, 39, -90);
    const b = lineY(38, 39, -91.2);
    expect(routeCorridorOverlapFraction(a, b)).toBeLessThan(0.15);
    expect(routesEffectivelySame(a, b)).toBe(false);
  });
});
