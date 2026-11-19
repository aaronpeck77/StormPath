import { describe, expect, it } from "vitest";
import {
  pickStayOnRoadRoute,
  STAY_ON_COURSE_MAX_EXTRA_MIN,
  STAY_ON_COURSE_VIA_AHEAD_M,
  stayOnCourseWaypoint,
} from "../stayOnCourse";
import { haversineMeters, initialBearingDegrees } from "../routeGeometry";
import type { LngLat, NavRoute } from "../types";

const USER: LngLat = [-96.0, 40.0];
const DEST: LngLat = [-95.0, 40.5];

function route(etaMin: number): NavRoute {
  return {
    id: "r-x",
    role: "fastest",
    label: "Main",
    geometry: [USER, DEST],
    baseEtaMinutes: etaMin,
  };
}

describe("stayOnCourseWaypoint", () => {
  it("projects a point ~1 km ahead on the travel heading", () => {
    const wp = stayOnCourseWaypoint({
      userLngLat: USER,
      headingDeg: 90,
      speedMps: 15,
      destLngLat: DEST,
    });
    expect(wp).not.toBeNull();
    const d = haversineMeters(USER, wp!);
    expect(d).toBeGreaterThan(STAY_ON_COURSE_VIA_AHEAD_M * 0.9);
    expect(d).toBeLessThan(STAY_ON_COURSE_VIA_AHEAD_M * 1.1);
    const bearing = initialBearingDegrees(USER, wp!);
    expect(Math.abs(bearing - 90)).toBeLessThan(5);
  });

  it("refuses when heading or speed cannot be trusted", () => {
    expect(
      stayOnCourseWaypoint({
        userLngLat: USER,
        headingDeg: null,
        speedMps: 15,
        destLngLat: DEST,
      })
    ).toBeNull();
    expect(
      stayOnCourseWaypoint({
        userLngLat: USER,
        headingDeg: 90,
        speedMps: 2,
        destLngLat: DEST,
      })
    ).toBeNull();
    expect(
      stayOnCourseWaypoint({
        userLngLat: USER,
        headingDeg: 90,
        speedMps: null,
        destLngLat: DEST,
      })
    ).toBeNull();
  });

  it("refuses when the destination is barely ahead of the via", () => {
    const nearDest: LngLat = [-96.0, 40.015];
    expect(
      stayOnCourseWaypoint({
        userLngLat: USER,
        headingDeg: 90,
        speedMps: 15,
        destLngLat: nearDest,
      })
    ).toBeNull();
  });
});

describe("pickStayOnRoadRoute", () => {
  it("adopts the driver's road at ETA parity", () => {
    const stay = { ...route(20), label: "Your way" };
    expect(
      pickStayOnRoadRoute({ stayRoute: stay, fastestRoute: route(20) })
    ).toBe(stay);
  });

  it("adopts the driver's road inside the extra-minutes cap", () => {
    const stay = { ...route(20 + STAY_ON_COURSE_MAX_EXTRA_MIN), label: "Your way" };
    expect(
      pickStayOnRoadRoute({ stayRoute: stay, fastestRoute: route(20) })
    ).toBe(stay);
  });

  it("keeps fastest when the driver's road costs more than the cap", () => {
    const fast = route(20);
    const stay = { ...route(20 + STAY_ON_COURSE_MAX_EXTRA_MIN + 1), label: "Your way" };
    expect(
      pickStayOnRoadRoute({ stayRoute: stay, fastestRoute: fast })
    ).toBe(fast);
  });

  it("falls back either way when one pool is empty", () => {
    const stay = route(21);
    const fast = route(20);
    expect(pickStayOnRoadRoute({ stayRoute: stay, fastestRoute: null })).toBe(stay);
    expect(pickStayOnRoadRoute({ stayRoute: null, fastestRoute: fast })).toBe(fast);
    expect(pickStayOnRoadRoute({ stayRoute: null, fastestRoute: null })).toBeNull();
  });
});
