import { describe, expect, it } from "vitest";
import { buildOffRouteRejoinFitBounds } from "../mapRouteLayers";
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

describe("buildOffRouteRejoinFitBounds", () => {
  it("includes user and both alternate legs without spanning the full locked route", () => {
    const user: [number, number] = [-86.78, 36.16];
    const primary = route("r-a", [
      [-87.0, 36.0],
      [-86.9, 36.05],
      [-86.8, 36.12],
      [-86.7, 36.2],
      [-86.5, 36.35],
    ]);
    const altB = route("r-b", [
      user,
      [-86.74, 36.18],
      [-86.68, 36.22],
    ]);
    const altC = route("r-c", [
      user,
      [-86.82, 36.12],
      [-86.88, 36.08],
    ]);
    const fit = buildOffRouteRejoinFitBounds(user, [primary, altB, altC], "r-a");
    expect(fit).not.toBeNull();
    const sw = fit!.bounds.getSouthWest();
    const ne = fit!.bounds.getNorthEast();
    expect(sw.lng).toBeLessThan(-86.88);
    expect(ne.lng).toBeGreaterThan(-86.68);
    expect(sw.lat).toBeLessThan(36.08);
    expect(ne.lat).toBeGreaterThan(36.22);
  });
});
