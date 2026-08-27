import { describe, expect, it } from "vitest";
import type { NavRoute } from "../../nav/types";
import { buildTripFitBounds, preferEndpointAnchoredTripFit } from "../mapRouteLayers";

function route(id: string, coords: [number, number][]): NavRoute {
  return {
    id,
    role: "balanced",
    label: id,
    geometry: coords,
    baseEtaMinutes: 12,
  };
}

describe("preferEndpointAnchoredTripFit", () => {
  const user: [number, number] = [-86.78, 36.16];
  const dest: [number, number] = [-86.62, 36.28];
  const straight: [number, number][] = [user, [-86.7, 36.22], dest];

  it("anchors short and medium straight trips on user + destination", () => {
    expect(preferEndpointAnchoredTripFit(user, dest, straight)).toBe(true);
  });

  it("anchors ~19 mi straight trips (previously fell through to full polyline)", () => {
    const nearDest: [number, number] = [-86.66, 36.24];
    const geom: [number, number][] = [user, [-86.72, 36.2], nearDest];
    expect(preferEndpointAnchoredTripFit(user, nearDest, geom)).toBe(true);
  });

  it("uses full polyline for cross-country legs", () => {
    const farDest: [number, number] = [-118.24, 34.05];
    const crossCountry = route("x", [user, [-100, 38], [-110, 36], farDest]);
    expect(preferEndpointAnchoredTripFit(user, farDest, crossCountry.geometry)).toBe(false);
  });

  it("uses full polyline when the path bulges far outside the start/end box", () => {
    const loop: [number, number][] = [
      user,
      [-86.9, 36.35],
      [-86.55, 36.35],
      dest,
    ];
    expect(preferEndpointAnchoredTripFit(user, dest, loop)).toBe(false);
  });
});

describe("buildTripFitBounds", () => {
  it("can still use endpoint-only when forceFullPolyline is off", () => {
    const user: [number, number] = [-86.78, 36.16];
    const dest: [number, number] = [-86.66, 36.24];
    const mildDetour = route("r-a", [user, [-86.74, 36.12], [-86.7, 36.2], dest]);
    const fit = buildTripFitBounds(user, dest, [mildDetour], "r-a", false);
    expect(fit?.endpointsOnly).toBe(true);
    const sw = fit!.bounds.getSouthWest();
    const ne = fit!.bounds.getNorthEast();
    expect(sw.lng).toBeCloseTo(Math.min(user[0], dest[0]), 2);
    expect(ne.lng).toBeCloseTo(Math.max(user[0], dest[0]), 2);
  });

  it("frames the full polyline when forceFullPolyline is on (pre-Go overview)", () => {
    const user: [number, number] = [-86.78, 36.16];
    const dest: [number, number] = [-86.66, 36.24];
    const bulge: [number, number] = [-86.9, 36.35];
    const winding = route("r-a", [user, bulge, dest]);
    const fit = buildTripFitBounds(user, dest, [winding], "r-a", true);
    expect(fit?.endpointsOnly).toBe(false);
    const sw = fit!.bounds.getSouthWest();
    const ne = fit!.bounds.getNorthEast();
    expect(sw.lng).toBeLessThanOrEqual(bulge[0] + 1e-9);
    expect(ne.lat).toBeGreaterThanOrEqual(bulge[1] - 1e-9);
  });

  it("unions every planned leg when onlyRouteId is omitted (pre-Go A+B)", () => {
    const user: [number, number] = [-86.78, 36.16];
    const dest: [number, number] = [-86.66, 36.24];
    const main = route("r-a", [user, [-86.72, 36.2], dest]);
    const altBulge: [number, number] = [-86.95, 36.05];
    const alt = route("r-b", [user, altBulge, dest]);
    const fit = buildTripFitBounds(user, dest, [main, alt], undefined, true);
    expect(fit?.endpointsOnly).toBe(false);
    const sw = fit!.bounds.getSouthWest();
    expect(sw.lng).toBeLessThanOrEqual(altBulge[0] + 1e-9);
    expect(sw.lat).toBeLessThanOrEqual(altBulge[1] + 1e-9);
  });
});
