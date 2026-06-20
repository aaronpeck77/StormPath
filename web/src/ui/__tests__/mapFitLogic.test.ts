import { describe, expect, it } from "vitest";
import type { NavRoute } from "../../nav/types";
import { routeFitZoomBias, routeViewAxis } from "../mapFitLogic";
import { smoothDriveBearingDeg } from "../mapDriveCamera";

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
});

describe("mapDriveCamera", () => {
  it("limits bearing step per frame", () => {
    const next = smoothDriveBearingDeg(0, 90, 1);
    expect(next).toBeLessThanOrEqual(11);
    expect(next).toBeGreaterThan(0);
  });
});
