import { describe, expect, it } from "vitest";
import type { ActivitySample } from "../activitySamples";
import {
  pickTrailPreferredRouteId,
  routeTrailOverlapScore,
  TRAIL_CORRIDOR_M,
} from "../trailRouteOverlap";
import type { NavRoute } from "../../nav/types";

function dot(lng: number, lat: number, t = 1): ActivitySample {
  return { t, lng, lat };
}

describe("routeTrailOverlapScore", () => {
  it("returns 0 when trail is too sparse", () => {
    const route: [number, number][] = [
      [-86.5, 39.1],
      [-86.4, 39.1],
    ];
    expect(routeTrailOverlapScore(route, [dot(-86.45, 39.1)])).toBe(0);
  });

  it("scores high when route follows trail corridor", () => {
    const route: [number, number][] = [
      [-86.52, 39.16],
      [-86.48, 39.16],
      [-86.44, 39.16],
    ];
    const samples: ActivitySample[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push(dot(-86.5 + i * 0.008, 39.16 + 0.0001 * i, i));
    }
    expect(routeTrailOverlapScore(route, samples)).toBeGreaterThan(0.35);
  });

  it("scores low when route is far from trail", () => {
    const route: [number, number][] = [
      [-86.52, 39.16],
      [-86.44, 39.16],
    ];
    const samples: ActivitySample[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push(dot(-86.5 + i * 0.008, 39.2, i));
    }
    const offTrail = routeTrailOverlapScore(route, samples);
    expect(offTrail).toBeLessThan(0.05);
    expect(TRAIL_CORRIDOR_M).toBeGreaterThan(100);
  });
});

describe("pickTrailPreferredRouteId", () => {
  const samples: ActivitySample[] = [];
  for (let i = 0; i < 12; i++) {
    samples.push(dot(-86.5 + i * 0.006, 39.16, i));
  }

  it("prefers familiar alt within ETA budget", () => {
    const routes: NavRoute[] = [
      {
        id: "r-a",
        role: "fastest",
        label: "Main",
        geometry: [
          [-86.52, 39.2],
          [-86.44, 39.2],
        ],
        baseEtaMinutes: 10,
      },
      {
        id: "r-b",
        role: "hazardSmart",
        label: "Alt",
        geometry: [
          [-86.52, 39.16],
          [-86.44, 39.16],
        ],
        baseEtaMinutes: 10.5,
      },
    ];
    expect(pickTrailPreferredRouteId(routes, samples)).toBe("r-b");
  });

  it("skips familiar route that is too slow vs A", () => {
    const routes: NavRoute[] = [
      {
        id: "r-a",
        role: "fastest",
        label: "Main",
        geometry: [
          [-86.52, 39.2],
          [-86.44, 39.2],
        ],
        baseEtaMinutes: 10,
      },
      {
        id: "r-b",
        role: "hazardSmart",
        label: "Alt",
        geometry: [
          [-86.52, 39.16],
          [-86.44, 39.16],
        ],
        baseEtaMinutes: 13,
      },
    ];
    expect(pickTrailPreferredRouteId(routes, samples)).toBeNull();
  });
});
