import { describe, expect, it } from "vitest";
import {
  isDriveCameraHeadingUp,
  resolveDriveFollowCameraBearingDeg,
  resolveTravelBearingDeg,
} from "../mapDriveCamera";

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
  it("uses course-over-ground when off route, not phone compass", () => {
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: true,
        routeBearingDeg: 10,
        headingDeg: 90,
        prevFix: { lng: -86.78, lat: 36.16 },
        curFix: { lng: -86.79, lat: 36.16 },
        mapBearing: 0,
        speedMps: 12,
      })
    ).toBeGreaterThan(260);
  });

  it("ignores phone compass when off route with no motion (keeps map / last travel)", () => {
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: true,
        routeBearingDeg: 45,
        headingDeg: 270,
        prevFix: null,
        curFix: null,
        mapBearing: 12,
        speedMps: 10,
      })
    ).toBe(12);
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: true,
        routeBearingDeg: 45,
        headingDeg: 270,
        prevFix: null,
        curFix: null,
        mapBearing: 12,
        lastTravelBearingDeg: 95,
        speedMps: 10,
      })
    ).toBe(95);
  });

  it("stays heading-up off route once travel bearing is known", () => {
    const travel = resolveDriveFollowCameraBearingDeg({
      offRouteForward: true,
      routeBearingDeg: null,
      headingDeg: 90,
      prevFix: { lng: -86.78, lat: 36.16 },
      curFix: { lng: -86.79, lat: 36.16 },
      mapBearing: 0,
      speedMps: 15,
    });
    expect(isDriveCameraHeadingUp({ cameraBearingDeg: travel, travelOrRouteBearingDeg: travel })).toBe(
      true
    );
    // Landscape compass must not win over held travel.
    const held = resolveDriveFollowCameraBearingDeg({
      offRouteForward: true,
      routeBearingDeg: null,
      headingDeg: 90,
      prevFix: null,
      curFix: null,
      mapBearing: 0,
      lastTravelBearingDeg: travel,
      speedMps: 15,
    });
    expect(held).toBe(travel);
    expect(isDriveCameraHeadingUp({ cameraBearingDeg: held, travelOrRouteBearingDeg: travel })).toBe(
      true
    );
  });

  it("prefers route tangent on corridor when motion agrees", () => {
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: false,
        routeBearingDeg: 270,
        headingDeg: 12,
        prevFix: { lng: -86.78, lat: 36.16 },
        curFix: { lng: -86.79, lat: 36.16 },
        mapBearing: 0,
        speedMps: 20,
      })
    ).toBe(270);
  });

  it("ignores phone compass when choosing on-corridor bearing", () => {
    expect(
      resolveDriveFollowCameraBearingDeg({
        offRouteForward: false,
        routeBearingDeg: 88,
        headingDeg: 12,
        prevFix: null,
        curFix: null,
        mapBearing: 40,
        speedMps: 20,
      })
    ).toBe(88);
  });

  it("keeps camera on course-over-ground when route look-ahead disagrees with motion", () => {
    const brg = resolveDriveFollowCameraBearingDeg({
      offRouteForward: false,
      routeBearingDeg: 10,
      headingDeg: 200,
      prevFix: { lng: -86.78, lat: 36.16 },
      curFix: { lng: -86.79, lat: 36.16 },
      mapBearing: 45,
      speedMps: 25,
    });
    expect(brg).toBeGreaterThan(260);
    expect(brg).toBeLessThan(280);
  });
});

describe("resolveTravelBearingDeg", () => {
  it("uses motion between fixes, not Geolocation heading", () => {
    expect(
      resolveTravelBearingDeg({
        headingDeg: 40,
        prevFix: { lng: -86.78, lat: 36.16 },
        curFix: { lng: -86.79, lat: 36.16 },
        speedMps: 8,
      })
    ).toBeGreaterThan(260);
  });

  it("returns null when not moving enough", () => {
    expect(
      resolveTravelBearingDeg({
        headingDeg: 40,
        prevFix: { lng: -86.78, lat: 36.16 },
        curFix: { lng: -86.78001, lat: 36.16 },
        speedMps: 8,
      })
    ).toBeNull();
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
