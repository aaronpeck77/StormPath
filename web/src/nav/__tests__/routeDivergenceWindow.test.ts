import { describe, expect, it } from "vitest";
import { findRouteDivergenceWindow } from "../routeDivergenceWindow";
import { buildTollCompareLocalFitBounds } from "../../ui/mapRouteLayers";
import type { LngLat, NavRoute } from "../types";

function lineY(y0: number, y1: number, x = -90): LngLat[] {
  const out: LngLat[] = [];
  for (let y = y0; y <= y1; y += 0.02) out.push([x, y]);
  return out;
}

describe("findRouteDivergenceWindow", () => {
  it("finds mid-route divergence between toll and bypass corridors", () => {
    const shared = lineY(38, 38.5);
    const toll: LngLat[] = [...shared, ...lineY(38.52, 39, -90)];
    const free: LngLat[] = [...shared, ...lineY(38.52, 39, -90.35)];
    const window = findRouteDivergenceWindow(toll, free, { padM: 0, mergeGapM: 500 });
    expect(window).not.toBeNull();
    expect(window!.startM).toBeGreaterThan(40_000);
    expect(window!.endM).toBeLessThan(120_000);
  });

  it("returns null when routes share the same corridor", () => {
    const a = lineY(38, 39);
    const b = lineY(38, 39.01);
    expect(findRouteDivergenceWindow(a, b)).toBeNull();
  });
});

describe("buildTollCompareLocalFitBounds", () => {
  it("frames the diverged segment, not the full cross-country trip", () => {
    const shared = lineY(38, 38.5, -87);
    const tollRoute: NavRoute = {
      id: "r-a",
      role: "balanced",
      label: "With tolls",
      geometry: [...shared, ...lineY(38.52, 39, -87)],
      baseEtaMinutes: 300,
    };
    const freeRoute: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "Toll-free",
      geometry: [...shared, ...lineY(38.52, 39, -87.35)],
      baseEtaMinutes: 320,
    };
    const fit = buildTollCompareLocalFitBounds([tollRoute, freeRoute]);
    expect(fit).not.toBeNull();
    const sw = fit!.bounds.getSouthWest();
    const ne = fit!.bounds.getNorthEast();
    expect(ne.lng - sw.lng).toBeLessThan(1.2);
    expect(sw.lng).toBeGreaterThan(-87.5);
    expect(ne.lng).toBeLessThan(-86.7);
  });
});
