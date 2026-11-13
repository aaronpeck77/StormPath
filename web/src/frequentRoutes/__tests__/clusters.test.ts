import { describe, expect, it } from "vitest";
import { mergeTripIntoClusters } from "../clusters";
import type { CompletedLearnedTrip, FrequentRouteCluster } from "../types";
import type { LngLat } from "../../nav/types";

function trip(start: [number, number], end: [number, number], endedAt: number): CompletedLearnedTrip {
  return {
    geometry: [start, end],
    startedAt: endedAt - 600_000,
    endedAt,
    distanceM: 12_000,
  };
}

function tripGeo(geometry: LngLat[], endedAt: number): CompletedLearnedTrip {
  return { geometry, startedAt: endedAt - 600_000, endedAt, distanceM: 12_000 };
}

function line(a: LngLat, b: LngLat, n = 12): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Two-segment dogleg a→via→b. */
function viaLine(a: LngLat, via: LngLat, b: LngLat, n = 12): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (t < 0.5) {
      const u = t / 0.5;
      out.push([a[0] + (via[0] - a[0]) * u, a[1] + (via[1] - a[1]) * u]);
    } else {
      const u = (t - 0.5) / 0.5;
      out.push([via[0] + (b[0] - via[0]) * u, via[1] + (b[1] - via[1]) * u]);
    }
  }
  return out;
}

describe("mergeTripIntoClusters", () => {
  it("merges reverse commutes into one cluster", () => {
    const home: [number, number] = [-88.95, 39.85];
    const work: [number, number] = [-88.2, 39.75];
    let clusters = mergeTripIntoClusters([], trip(home, work, 1_000));
    clusters = mergeTripIntoClusters(clusters, trip(work, home, 2_000));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(2);
  });

  it("keeps the consensus trace when one trip doglegs far off corridor", () => {
    const home: LngLat = [-88.95, 39.85];
    const work: LngLat = [-88.2, 39.75];
    const normal = () => line(home, work, 12);
    // Same endpoints (so it merges) but a ~30 km northern loop, densified to
    // win the old "most points" rule.
    const weird = viaLine(home, [-88.5, 40.15], work, 60);

    let clusters = mergeTripIntoClusters([], tripGeo(normal(), 1_000));
    clusters = mergeTripIntoClusters(clusters, tripGeo(weird, 2_000));
    clusters = mergeTripIntoClusters(clusters, tripGeo(normal(), 3_000));
    clusters = mergeTripIntoClusters(clusters, tripGeo(normal(), 4_000));

    const c = clusters[0]!;
    expect(c.count).toBe(4);
    expect(c.geometries).toHaveLength(4);
    // Consensus stays on the direct corridor — the northern dogleg (40.15)
    // never becomes the offered "Your route" geometry.
    const maxLat = Math.max(...c.geometry.map((p) => p[1]));
    expect(maxLat).toBeLessThan(39.9);
  });

  it("seeds trace history for legacy clusters that predate geometries", () => {
    const home: LngLat = [-88.95, 39.85];
    const work: LngLat = [-88.2, 39.75];
    const legacy: FrequentRouteCluster = {
      id: "fr-legacy",
      count: 5,
      lastSeen: 1_000,
      geometry: line(home, work, 12),
      centerStart: home,
      centerEnd: work,
      recentStarts: [500, 800],
    };
    const nextTrip = line(home, work, 20);
    const clusters = mergeTripIntoClusters([legacy], tripGeo(nextTrip, 2_000));
    expect(clusters[0]!.geometries).toHaveLength(2);
    expect(clusters[0]!.geometries![0]).toEqual(legacy.geometry);
    expect(clusters[0]!.geometries![1]).toEqual(nextTrip);
  });
});
