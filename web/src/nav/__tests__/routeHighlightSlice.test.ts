import { describe, expect, it } from "vitest";
import {
  polylineLengthMeters,
  slicePolylineBetweenAlongForDisplay,
} from "../routeGeometry";
import type { LngLat } from "../types";

/** Dense zig-zag — subsampling the whole route would cut corners; slice-first should not. */
function denseZigRoute(count: number): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < count; i++) {
    out.push([-90 + i * 0.002, 38 + (i % 2 === 0 ? 0.001 : -0.001)]);
  }
  return out;
}

describe("slicePolylineBetweenAlongForDisplay", () => {
  it("follows road vertices on long routes instead of chord shortcuts", () => {
    const route = denseZigRoute(12_000);
    const total = polylineLengthMeters(route);
    expect(total).toBeGreaterThan(500_000);

    const mid = total * 0.42;
    const half = 25_000;
    const slice = slicePolylineBetweenAlongForDisplay(route, mid - half, mid + half, total);
    expect(slice.length).toBeGreaterThan(80);
    expect(slice.length).toBeLessThan(900);

    for (let i = 1; i < slice.length; i++) {
      const dLng = Math.abs(slice[i]![0]! - slice[i - 1]![0]!);
      expect(dLng).toBeLessThan(0.01);
    }
  });
});
