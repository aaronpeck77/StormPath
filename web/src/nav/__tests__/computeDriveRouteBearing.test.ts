import { describe, expect, it } from "vitest";
import { computeDriveRouteBearing } from "../computeDriveRouteBearing";
import type { LngLat } from "../types";

const geom: LngLat[] = [
  [-90.2, 38.6],
  [-90.19, 38.61],
  [-90.18, 38.62],
  [-90.17, 38.63],
];

describe("computeDriveRouteBearing", () => {
  it("returns null when drive framing is off-route or not drive UI", () => {
    expect(
      computeDriveRouteBearing({
        driveOffRouteForwardFraming: true,
        driveModeUi: true,
        effectiveUserLngLat: [-90.2, 38.6],
        geometry: geom,
        speedMps: 10,
        navigationStarted: true,
        userAlongGuidanceM: 0,
      })
    ).toBeNull();
    expect(
      computeDriveRouteBearing({
        driveOffRouteForwardFraming: false,
        driveModeUi: false,
        effectiveUserLngLat: [-90.2, 38.6],
        geometry: geom,
        speedMps: 10,
        navigationStarted: true,
        userAlongGuidanceM: 0,
      })
    ).toBeNull();
  });

  it("returns a finite bearing when on corridor in drive mode", () => {
    const b = computeDriveRouteBearing({
      driveOffRouteForwardFraming: false,
      driveModeUi: true,
      effectiveUserLngLat: [-90.2, 38.6],
      geometry: geom,
      speedMps: 12,
      navigationStarted: true,
      userAlongGuidanceM: 50,
    });
    expect(b).not.toBeNull();
    expect(Number.isFinite(b)).toBe(true);
  });
});
