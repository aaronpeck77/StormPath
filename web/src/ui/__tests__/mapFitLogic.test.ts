import { describe, expect, it } from "vitest";
import type { NavRoute } from "../../nav/types";
import {
  maxRouteOverviewZoomDuringNav,
  minPlanningRouteZoomFloor,
  routeFitZoomBias,
  routeViewAxis,
} from "../mapFitLogic";
import { smoothDriveBearingDeg } from "../mapDriveCamera";
import { EXTREME_TRIP_ROUTE_M, LONG_TRIP_ROUTE_M, ULTRA_LONG_TRIP_ROUTE_M } from "../../utils/dataSaver";

function route(id: string, coords: [number, number][]): NavRoute {
  return {
    id,
    role: "balanced",
    label: id,
    geometry: coords,
    baseEtaMinutes: 10,
  };
}

describe("mapFitLogic", () => {
  it("classifies east-west routes by bbox aspect", () => {
    const eastWest = route("ew", [
      [-87.0, 36.0],
      [-86.5, 36.0],
      [-86.0, 36.0],
    ]);
    expect(routeViewAxis([eastWest], "ew")).toBe("eastWest");
  });

  it("boosts zoom bias for short portrait trips", () => {
    const short = route("s", [
      [-86.78, 36.16],
      [-86.77, 36.17],
    ]);
    expect(routeFitZoomBias([short], "s")).toBeGreaterThan(1.5);
  });

  it("raises minimum planning zoom for short local routes", () => {
    expect(minPlanningRouteZoomFloor(8_000)).toBeGreaterThan(10);
    expect(minPlanningRouteZoomFloor(120_000)).toBeLessThan(7);
  });

  it("caps Rt overview zoom during long nav trips", () => {
    expect(maxRouteOverviewZoomDuringNav(LONG_TRIP_ROUTE_M)).toBeLessThan(10);
    expect(maxRouteOverviewZoomDuringNav(ULTRA_LONG_TRIP_ROUTE_M)).toBeLessThan(7.5);
    expect(maxRouteOverviewZoomDuringNav(EXTREME_TRIP_ROUTE_M)).toBeLessThan(6);
  });
});

describe("mapDriveCamera", () => {
  it("limits bearing step per frame", () => {
    const next = smoothDriveBearingDeg(0, 90, 1);
    expect(next).toBeLessThanOrEqual(11);
    expect(next).toBeGreaterThan(0);
  });
});
