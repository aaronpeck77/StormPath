import { describe, expect, it } from "vitest";
import {
  measureOffRouteLateral,
  OFF_ROUTE_REROUTE_ENTER_M,
  shouldExitOffRouteLatch,
  shouldTriggerOffRouteReroute,
} from "../offRouteDetect";
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

describe("shouldTriggerOffRouteReroute", () => {
  it("triggers when lateral exceeds enter threshold", () => {
    expect(
      shouldTriggerOffRouteReroute(OFF_ROUTE_REROUTE_ENTER_M + 0.5, { speedMps: 5 })
    ).toBe(true);
    expect(
      shouldTriggerOffRouteReroute(OFF_ROUTE_REROUTE_ENTER_M - 0.5, { speedMps: 5 })
    ).toBe(false);
  });

  it("triggers on heading mismatch when slightly off-line and moving", () => {
    expect(
      shouldTriggerOffRouteReroute(2.5, {
        headingDeg: 90,
        routeBearingDeg: 0,
        speedMps: 5,
      })
    ).toBe(true);
  });

  it("requires a wider offset when stopped (GPS drift)", () => {
    expect(shouldTriggerOffRouteReroute(20, { speedMps: 0 })).toBe(false);
    expect(shouldTriggerOffRouteReroute(39, { speedMps: 0 })).toBe(true);
    expect(shouldTriggerOffRouteReroute(20, { speedMps: 5 })).toBe(true);
  });
});

describe("shouldExitOffRouteLatch", () => {
  it("clears latch only when back inside exit threshold", () => {
    expect(shouldExitOffRouteLatch(4)).toBe(true);
    expect(shouldExitOffRouteLatch(12)).toBe(false);
  });
});
