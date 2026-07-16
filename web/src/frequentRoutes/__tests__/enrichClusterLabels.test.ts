import { describe, expect, it } from "vitest";
import { formatFrequentClusterEndpoints } from "../enrichClusterLabels";
import { geometryToPreviewPath } from "../routePreviewPath";
import type { FrequentRouteCluster } from "../types";

const base: FrequentRouteCluster = {
  id: "fr-1",
  count: 3,
  lastSeen: 1,
  geometry: [
    [-90.2, 38.6],
    [-90.15, 38.62],
    [-90.1, 38.65],
  ],
  centerStart: [-90.2, 38.6],
  centerEnd: [-90.1, 38.65],
};

describe("formatFrequentClusterEndpoints", () => {
  it("prefers place labels when present", () => {
    const { from, to } = formatFrequentClusterEndpoints(
      { ...base, startLabel: "Home St, IL", endLabel: "Work Ave, IL" },
      () => "coords"
    );
    expect(from).toBe("Home St, IL");
    expect(to).toBe("Work Ave, IL");
  });

  it("falls back to coordinates when labels are missing", () => {
    const { from, to } = formatFrequentClusterEndpoints(base, (lng, lat) => `${lat},${lng}`);
    expect(from).toBe("38.6,-90.2");
    expect(to).toBe("38.65,-90.1");
  });
});

describe("geometryToPreviewPath", () => {
  it("builds an SVG path from route geometry", () => {
    const path = geometryToPreviewPath(base.geometry);
    expect(path).toMatch(/^M/);
    expect(path).toContain("L");
  });

  it("returns null for short geometry", () => {
    expect(geometryToPreviewPath([[-90, 38]])).toBeNull();
  });
});
