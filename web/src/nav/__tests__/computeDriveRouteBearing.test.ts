import { describe, expect, it } from "vitest";
import {
  computeDriveRouteBearing,
  driveAlignLookAheadMeters,
  driveRouteLookAheadMeters,
  liveDriveAlignBearing,
  type LiveAlignBearingState,
} from "../computeDriveRouteBearing";
import { buildCumulativeDistances, pointAtAlongMeters } from "../routeGeometry";
import type { LngLat } from "../types";

/** 180 m north, then 180 m east. A sharp city corner. */
function northThenEast(): LngLat[] {
  const lat0 = 38.63;
  const lng0 = -90.2;
  const north = 180 / 111320;
  const east = 180 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  return [
    [lng0, lat0],
    [lng0, lat0 + north],
    [lng0 + east, lat0 + north],
  ];
}

function signedDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

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

describe("liveDriveAlignBearing", () => {
  it("keeps a steady look-ahead so the heading does not step when a turn gets close", () => {
    const slow = driveAlignLookAheadMeters(8);
    const fast = driveAlignLookAheadMeters(20);
    expect(fast).toBeGreaterThan(slow);
    expect(fast - slow).toBeLessThan(30);
    expect(driveAlignLookAheadMeters(8)).toBe(driveAlignLookAheadMeters(8));
  });

  it("faces the next street by the corner and does not swing back", () => {
    const geom = northThenEast();
    const cum = buildCumulativeDistances(geom);
    const cornerM = cum[1]!;
    const state: LiveAlignBearingState = { geomKey: "", cum: null, alongM: null };
    let prev: number | null = null;
    for (let along = 0; along <= cornerM + 30; along += 5) {
      const puck = pointAtAlongMeters(geom, along, cum);
      const b = liveDriveAlignBearing({
        state,
        geometry: geom,
        puck,
        speedMps: 10,
        seedAlongM: 0,
        offRoute: false,
      });
      expect(b).not.toBeNull();
      if (prev != null && b != null) {
        expect(signedDelta(prev, b)).toBeGreaterThanOrEqual(-1);
      }
      prev = b;
      if (along + 1e-6 >= cornerM) {
        expect(b!).toBeGreaterThan(80);
        expect(b!).toBeLessThan(100);
      }
    }
  });

  it("stays on the approach road until the corner is inside the look-ahead", () => {
    const geom = northThenEast();
    const cum = buildCumulativeDistances(geom);
    const cornerM = cum[1]!;
    const state: LiveAlignBearingState = { geomKey: "", cum: null, alongM: null };
    const look = driveAlignLookAheadMeters(10);
    const puck = pointAtAlongMeters(geom, Math.max(0, cornerM - look - 25), cum);
    const b = liveDriveAlignBearing({
      state,
      geometry: geom,
      puck,
      speedMps: 10,
      seedAlongM: 0,
      offRoute: false,
    });
    expect(b).not.toBeNull();
    expect(b!).toBeLessThan(8);
  });

  it("does not follow the route while the car is off it", () => {
    const geom = northThenEast();
    const state: LiveAlignBearingState = { geomKey: "", cum: null, alongM: null };
    expect(
      liveDriveAlignBearing({
        state,
        geometry: geom,
        puck: geom[0]!,
        speedMps: 10,
        seedAlongM: 0,
        offRoute: true,
      })
    ).toBeNull();
  });
});
