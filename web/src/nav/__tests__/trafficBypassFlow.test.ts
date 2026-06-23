import { describe, expect, it } from "vitest";
import {
  trafficBypassOfferHeadline,
  withTrafficBypassCompareKind,
  TRAFFIC_BYPASS_CONFIRM_LABEL_NAV,
} from "../trafficBypassFlow";

describe("trafficBypassFlow", () => {
  it("tags compare state as traffic bypass", () => {
    const state = withTrafficBypassCompareKind({
      headline: "Jam ahead",
      etaA: 20,
      etaB: 18,
      etaC: null,
      hasB: true,
      hasC: false,
      confidence: "medium",
      selectedLeg: "r-a",
      hazardLngLat: null,
      hazardAlongMeters: 1200,
    });
    expect(state.compareKind).toBe("traffic");
  });

  it("builds offer headlines with distance context", () => {
    expect(
      trafficBypassOfferHeadline({
        headline: "Heavy traffic",
        aheadMi: 4.2,
        delayMinutes: 14,
        confidence: "high",
        category: "traffic",
      })
    ).toMatch(/compare routes/i);
  });

  it("uses explicit confirm label for navigation", () => {
    expect(TRAFFIC_BYPASS_CONFIRM_LABEL_NAV).toMatch(/switch/i);
  });
});
