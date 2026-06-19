import { describe, expect, it } from "vitest";
import { buildRouteCompareLocalFitBounds } from "../mapRouteLayers";
import type { NavRoute } from "../../nav/types";

function route(id: string, coords: [number, number][]): NavRoute {
  return {
    id,
    role: "balanced",
    label: id,
    geometry: coords,
    baseEtaMinutes: 12,
  };
}

describe("buildRouteCompareLocalFitBounds", () => {
  it("frames user + hazard + local ahead slices without spanning the full trip", () => {
    const user: [number, number] = [-86.78, 36.16];
    const hazard: [number, number] = [-86.72, 36.19];
    const primary = route("r-a", [
      [-87.5, 35.5],
      [-87.0, 35.9],
      [-86.85, 36.08],
      [-86.78, 36.16],
      [-86.72, 36.19],
      [-86.5, 36.35],
      [-86.0, 36.8],
    ]);
    const altB = route("r-b", [
      user,
      [-86.76, 36.18],
      [-86.7, 36.22],
      [-86.4, 36.5],
      [-86.0, 36.8],
    ]);
    const altC = route("r-c", [
      user,
      [-86.8, 36.14],
      [-86.74, 36.17],
      [-86.4, 36.5],
      [-86.0, 36.8],
    ]);
    const fit = buildRouteCompareLocalFitBounds(user, [primary, altB, altC], "r-a", hazard, {
      userAlongM: 120_000,
      hazardAlongM: 125_000,
    });
    expect(fit).not.toBeNull();
    const sw = fit!.bounds.getSouthWest();
    const ne = fit!.bounds.getNorthEast();
    expect(sw.lng).toBeGreaterThan(-87.0);
    expect(ne.lng).toBeLessThan(-86.35);
    expect(sw.lat).toBeGreaterThan(36.05);
    expect(ne.lat).toBeLessThan(36.55);
  });
});
