import { describe, expect, it } from "vitest";
import { resolveNavigationProgress, NAV_PROGRESS_LATERAL_TRUST_M } from "../navigationProgress";
import type { LngLat } from "../types";

function northRoute(count: number, startLat = 41): LngLat[] {
  const out: LngLat[] = [[-87, startLat]];
  for (let i = 1; i < count; i++) {
    out.push([-87, startLat + i * 0.001]);
  }
  return out;
}

describe("resolveNavigationProgress", () => {
  it("prefers map-matched position when it stays on the route corridor", () => {
    const geometry = northRoute(40);
    const raw: LngLat = [-87.001, 41.01];
    const matched: LngLat = [-87, 41.01];
    const result = resolveNavigationProgress({
      rawLngLat: raw,
      matchedLngLat: matched,
      matchedConfidence: 0.9,
      geometry,
      alongHoldM: 0,
    });
    expect(result.source).toBe("map_matched");
    expect(result.onRoute).toBe(true);
    expect(result.positionLngLat).toEqual(matched);
    expect(result.lateralM).toBeLessThanOrEqual(NAV_PROGRESS_LATERAL_TRUST_M);
  });

  it("holds along-route progress when GPS leaves the corridor", () => {
    const geometry = northRoute(40);
    const heldAlong = 800;
    const far: LngLat = [-87.08, 41.02];
    const result = resolveNavigationProgress({
      rawLngLat: far,
      matchedLngLat: null,
      geometry,
      alongHoldM: heldAlong,
    });
    expect(result.source).toBe("held");
    expect(result.onRoute).toBe(false);
    expect(result.alongM).toBe(heldAlong);
  });
});
