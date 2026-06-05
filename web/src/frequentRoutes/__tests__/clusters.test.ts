import { describe, expect, it } from "vitest";
import { mergeTripIntoClusters } from "../clusters";
import type { CompletedLearnedTrip } from "../types";

function trip(start: [number, number], end: [number, number], endedAt: number): CompletedLearnedTrip {
  return {
    geometry: [start, end],
    startedAt: endedAt - 600_000,
    endedAt,
    distanceM: 12_000,
  };
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
});
