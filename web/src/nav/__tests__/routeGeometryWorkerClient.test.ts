import { describe, expect, it } from "vitest";
import { buildCumulativeDistances, buildCumulativeDistancesAsync } from "../routeGeometryWorkerClient";
import type { LngLat } from "../types";

function longGeometry(n: number): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    out.push([-86.8 + i * 0.0001, 36.1 + i * 0.00005]);
  }
  return out;
}

describe("routeGeometryWorkerClient", () => {
  it("matches sync cumulative distances for short polylines", async () => {
    const geom = longGeometry(20);
    const sync = buildCumulativeDistances(geom);
    const async = await buildCumulativeDistancesAsync(geom);
    expect(async.length).toBe(sync.length);
    expect(async[async.length - 1]).toBeCloseTo(sync[sync.length - 1]!, 6);
  });

  it("builds cumulative distances for long polylines via worker or fallback", async () => {
    const geom = longGeometry(900);
    const sync = buildCumulativeDistances(geom);
    const async = await buildCumulativeDistancesAsync(geom);
    expect(async.length).toBe(sync.length);
    expect(async[async.length - 1]).toBeCloseTo(sync[sync.length - 1]!, 4);
  });
});
