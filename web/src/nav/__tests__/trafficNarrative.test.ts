import { describe, expect, it } from "vitest";
import type { MapboxTrafficLeg } from "../../services/mapboxDirectionsTraffic";
import { hasLocalizedTrafficIssue, unifiedTrafficNarrative } from "../trafficNarrative";

const baseLeg: MapboxTrafficLeg = {
  mapboxDurationMinutes: 60,
  typicalDurationMinutes: 54,
  delayVsTypicalMinutes: 6,
  congestionSummary: "moderate",
  hasClosure: false,
  nearStopFraction: null,
  firstHeavyCongestionFraction: null,
};

describe("hasLocalizedTrafficIssue", () => {
  it("is false for route-wide delay only", () => {
    expect(hasLocalizedTrafficIssue(baseLeg)).toBe(false);
  });

  it("is true for closure, near-stop, or heavy segment anchors", () => {
    expect(hasLocalizedTrafficIssue({ ...baseLeg, hasClosure: true })).toBe(true);
    expect(hasLocalizedTrafficIssue({ ...baseLeg, nearStopFraction: 0.35 })).toBe(true);
    expect(hasLocalizedTrafficIssue({ ...baseLeg, firstHeavyCongestionFraction: 0.42 })).toBe(true);
  });
});

describe("unifiedTrafficNarrative surface gating", () => {
  it("suppresses progress strip and corridor flags for route-wide delay only", () => {
    const n = unifiedTrafficNarrative(6, baseLeg, true, 60);
    expect(n.advisoryHeadline).toBe("Slower than usual");
    expect(n.shouldAddCorridorAlert).toBe(false);
    expect(n.progressStartLine).toBeNull();
  });

  it("keeps localized near-stop on the progress surfaces", () => {
    const leg = { ...baseLeg, nearStopFraction: 0.4 };
    const n = unifiedTrafficNarrative(6, leg, true, 60);
    expect(n.shouldAddCorridorAlert).toBe(true);
    expect(n.progressStartLine).toMatch(/Near-stopped/);
  });
});
