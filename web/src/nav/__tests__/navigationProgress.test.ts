import { describe, expect, it } from "vitest";
import { resolveNavigationProgress, NAV_PROGRESS_LATERAL_TRUST_M, stabilizeAlongMeters } from "../navigationProgress";
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

describe("stabilizeAlongMeters", () => {
  it("ignores reverse chatter while moving at speed", () => {
    expect(
      stabilizeAlongMeters({
        prevAlongM: 2_000,
        proposedAlongM: 1_700,
        speedMps: 18,
        dtS: 0.2,
      })
    ).toBe(2_000);
  });

  it("caps a huge forward jump between updates", () => {
    const next = stabilizeAlongMeters({
      prevAlongM: 2_000,
      proposedAlongM: 8_000,
      speedMps: 15,
      dtS: 0.2,
    });
    expect(next).toBeLessThan(3_000);
    expect(next).toBeGreaterThan(2_000);
  });

  it("does not walk along the route while parked", () => {
    expect(
      stabilizeAlongMeters({
        prevAlongM: 0,
        proposedAlongM: 80,
        speedMps: 0.2,
        dtS: 0.4,
      })
    ).toBe(0);
  });

  it("does not creep along from GPS wobble while parked", () => {
    expect(
      stabilizeAlongMeters({
        prevAlongM: 0,
        proposedAlongM: 8,
        speedMps: 0.2,
        dtS: 0.4,
      })
    ).toBe(0);
  });

  it("holds along when speed is still unknown at Go", () => {
    expect(
      stabilizeAlongMeters({
        prevAlongM: 0,
        proposedAlongM: 40,
        speedMps: null,
        dtS: 0.4,
      })
    ).toBe(0);
  });
});
