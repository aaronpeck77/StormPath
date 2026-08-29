import { describe, expect, it } from "vitest";
import {
  formatNearbyPoiTipLine,
  pickNearbyPoiCategory,
  shouldFetchNearbyPoiTip,
} from "../nearbyPoiTip";

describe("formatNearbyPoiTipLine", () => {
  it("formats short and mile distances", () => {
    expect(formatNearbyPoiTipLine("McDonald's", 160)).toMatch(/block/);
    expect(formatNearbyPoiTipLine("State Park", 8047)).toMatch(/mi/);
    expect(formatNearbyPoiTipLine("Museum", null)).toBe("Museum nearby");
  });
});

describe("shouldFetchNearbyPoiTip", () => {
  const base = {
    nowMs: 1_000_000,
    lastFetchMs: null as number | null,
    lastFetchLngLat: null as [number, number] | null,
    userLngLat: [-88.9, 39.8] as [number, number],
    speedMps: 12,
    navigationStarted: true,
    hazardBannerActive: false,
  };

  it("requires active navigation without hazard banner", () => {
    expect(shouldFetchNearbyPoiTip({ ...base, navigationStarted: false })).toBe(false);
    expect(shouldFetchNearbyPoiTip({ ...base, hazardBannerActive: true })).toBe(false);
    expect(shouldFetchNearbyPoiTip(base)).toBe(true);
  });

  it("skips when still near the last tip", () => {
    expect(
      shouldFetchNearbyPoiTip({
        ...base,
        lastFetchMs: 900_000,
        lastFetchLngLat: [-88.9, 39.8],
      })
    ).toBe(false);
  });
});

describe("pickNearbyPoiCategory", () => {
  it("rotates through the allowlist", () => {
    expect(pickNearbyPoiCategory(0).query).toBe("park");
    expect(pickNearbyPoiCategory(2).query).toBe("restaurant");
  });
});
