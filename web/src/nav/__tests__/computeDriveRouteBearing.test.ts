import { describe, expect, it } from "vitest";
import { computeDriveRouteBearing, driveRouteLookAheadMeters } from "../computeDriveRouteBearing";
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

  it("does not stretch look-ahead a block before the turn", () => {
    const far = driveRouteLookAheadMeters(14, 160);
    const near = driveRouteLookAheadMeters(14, 50);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThan(110);
    expect(near).toBeGreaterThan(90);
  });

  it("computes a bearing far and near a maneuver", () => {
    const far = computeDriveRouteBearing({
      driveOffRouteForwardFraming: false,
      driveModeUi: true,
      effectiveUserLngLat: [-90.2, 38.6],
      geometry: geom,
      speedMps: 14,
      navigationStarted: true,
      userAlongGuidanceM: 0,
      metersToManeuver: 120,
    });
    const near = computeDriveRouteBearing({
      driveOffRouteForwardFraming: false,
      driveModeUi: true,
      effectiveUserLngLat: [-90.2, 38.6],
      geometry: geom,
      speedMps: 14,
      navigationStarted: true,
      userAlongGuidanceM: 0,
      metersToManeuver: 20,
    });
    expect(far).not.toBeNull();
    expect(near).not.toBeNull();
    expect(Number.isFinite(far)).toBe(true);
    expect(Number.isFinite(near)).toBe(true);
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
