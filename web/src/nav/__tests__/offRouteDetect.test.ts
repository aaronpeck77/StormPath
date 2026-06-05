import { describe, expect, it } from "vitest";
import { measureOffRouteLateral } from "../offRouteDetect";
import type { LngLat } from "../types";

/** Simple northbound corridor ~10 km with a distant parallel leg (U-shaped route). */
function uShapedRoute(): LngLat[] {
  const north: LngLat[] = [];
  for (let i = 0; i <= 100; i += 1) {
    north.push([-88.0, 39.0 + i * 0.0009]);
  }
  const south: LngLat[] = [];
  for (let i = 100; i >= 0; i -= 1) {
    south.push([-87.9997, 39.0 + i * 0.0009]);
  }
  return [...north, ...south];
}

describe("measureOffRouteLateral", () => {
  it("reports small lateral when on the corridor near the hint", () => {
    const route = uShapedRoute();
    const mid = route[50]!;
    const sample = measureOffRouteLateral(mid, route, 5_000);
    expect(sample.lateralM).toBeLessThan(8);
  });

  it("uses windowed lateral when a far parallel leg would win a full scan", () => {
    const route = uShapedRoute();
    const onNorthLeg = route[50]!;
    /* ~27 m east of the northbound leg — near where the return leg runs on the east side. */
    const off: LngLat = [onNorthLeg[0]! + 0.00032, onNorthLeg[1]!];
    const sample = measureOffRouteLateral(off, route, 5_000);
    expect(sample.lateralM).toBeGreaterThan(26);
    expect(sample.fullScanLateralM).toBeLessThan(20);
  });
});
