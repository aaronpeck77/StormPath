import { describe, expect, it } from "vitest";
import { resolveDriveFollowCameraBearingDeg } from "../mapDriveCamera";

/** Mirror of drive follow-cam center drift check in DriveMap (lng/lat delta). */
function driveCameraNeedsCenterSync(
  camCenter: [number, number] | null,
  puckPos: [number, number] | null,
  noopDelta = 0.000005
): boolean {
  if (!camCenter || !puckPos) return false;
  return (
    Math.abs(camCenter[0] - puckPos[0]) > noopDelta ||
    Math.abs(camCenter[1] - puckPos[1]) > noopDelta
  );
}

describe("resolveDriveFollowCameraBearingDeg", () => {
  it("uses vehicle heading when off route in drive", () => {
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: true,
        routeBearingDeg: 10,
        headingDeg: 275,
        prevFix: null,
        curFix: null,
        mapBearing: 0,
      })
    ).toBe(275);
  });

  it("ignores backward route tangent when off route", () => {
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: true,
        routeBearingDeg: 45,
        headingDeg: 270,
        prevFix: null,
        curFix: null,
        mapBearing: 0,
      })
    ).toBe(270);
  });

  it("uses motion bearing when heading is missing off route", () => {
    const brg = resolveDriveFollowCameraBearingDeg({
      offRouteForward: true,
      routeBearingDeg: 90,
      headingDeg: null,
      prevFix: { lng: -86.78, lat: 36.16 },
      curFix: { lng: -86.79, lat: 36.16 },
      mapBearing: 0,
    });
    expect(brg).toBeGreaterThan(260);
    expect(brg).toBeLessThan(280);
  });

  it("prefers route tangent while on corridor", () => {
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: false,
        routeBearingDeg: 88,
        headingDeg: 12,
        prevFix: null,
        curFix: null,
        mapBearing: 0,
      })
    ).toBe(88);
  });
});

describe("driveCameraNeedsCenterSync", () => {
  it("detects desync even when the puck did not move this frame", () => {
    const puck: [number, number] = [-86.78, 36.16];
    const cam: [number, number] = [-86.79, 36.16];
    expect(driveCameraNeedsCenterSync(cam, puck)).toBe(true);
  });

  it("ignores sub-meter jitter", () => {
    const puck: [number, number] = [-86.78, 36.16];
    const cam: [number, number] = [-86.7800001, 36.1600001];
    expect(driveCameraNeedsCenterSync(cam, puck)).toBe(false);
  });
});
