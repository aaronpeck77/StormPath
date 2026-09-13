import { describe, expect, it } from "vitest";
import type { NavRoute } from "../../nav/types";
import {
  maxRouteOverviewZoomDuringNav,
  minPlanningRouteZoomFloor,
  padChromeWithEdgeStrip,
  planningRoutesFitKey,
  ROUTE_EDGE_STRIP_PX,
  routeFitZoomBias,
  routeOverviewProgressBucket,
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

  it("hashes every pre-Go leg so A and B share one overview frame", () => {
    const a = route("r-a", [
      [-86.78, 36.16],
      [-86.66, 36.24],
    ]);
    const b = route("r-b", [
      [-86.78, 36.16],
      [-86.95, 36.05],
      [-86.66, 36.24],
    ]);
    const dest: [number, number] = [-86.66, 36.24];
    const all = planningRoutesFitKey([a, b], null, dest);
    const onlyA = planningRoutesFitKey([a, b], "r-a", dest);
    expect(all).toContain("r-a");
    expect(all).toContain("r-b");
    expect(all).not.toBe(onlyA);
  });

  it("does not change the planning fit key when only dest snaps", () => {
    const a = route("r-a", [
      [-86.78, 36.16],
      [-86.66, 36.24],
    ]);
    const destA: [number, number] = [-86.66, 36.24];
    const destB: [number, number] = [-86.661, 36.241];
    expect(planningRoutesFitKey([a], null, destA)).toBe(planningRoutesFitKey([a], null, destB));
  });

  it("tightens Rt progress buckets as remaining distance shrinks", () => {
    expect(routeOverviewProgressBucket(80_000)).not.toBe(routeOverviewProgressBucket(20_000));
    expect(routeOverviewProgressBucket(20_000)).not.toBe(routeOverviewProgressBucket(3_000));
    expect(routeOverviewProgressBucket(200)).toBe("arrive");
  });

  it("adds only a thin strip outside chrome so puck and dest sit on the rim", () => {
    const padded = padChromeWithEdgeStrip({ top: 60, bottom: 80, left: 10, right: 50 });
    expect(padded.top).toBe(60 + ROUTE_EDGE_STRIP_PX);
    expect(padded.bottom).toBe(80 + ROUTE_EDGE_STRIP_PX);
    expect(ROUTE_EDGE_STRIP_PX).toBeLessThanOrEqual(16);
  });
});

describe("mapDriveCamera", () => {
  it("limits bearing step per frame", () => {
    const next = smoothDriveBearingDeg(0, 90, 1);
    expect(next).toBeLessThanOrEqual(11);
    expect(next).toBeGreaterThan(0);
  });
});
