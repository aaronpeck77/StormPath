import { describe, expect, it } from "vitest";
import { mapboxMaxSpeedToMph, postedSpeedMphAt } from "../postedSpeed";
import type { NavRoute } from "../types";

describe("mapboxMaxSpeedToMph", () => {
  it("parses mph and km/h", () => {
    expect(mapboxMaxSpeedToMph({ speed: 55, unit: "mph" })).toBe(55);
    expect(mapboxMaxSpeedToMph({ speed: 90, unit: "km/h" })).toBe(56);
  });

  it("returns null for unknown or unlimited", () => {
    expect(mapboxMaxSpeedToMph("unknown")).toBeNull();
    expect(mapboxMaxSpeedToMph({ unlimited: true })).toBeNull();
    expect(mapboxMaxSpeedToMph(null)).toBeNull();
  });
});

describe("postedSpeedMphAt", () => {
  const route: Pick<NavRoute, "postedSpeedSamples"> = {
    postedSpeedSamples: [
      { alongMeters: 0, mph: 35 },
      { alongMeters: 500, mph: 55 },
      { alongMeters: 2000, mph: 65 },
    ],
  };

  it("returns limit for the active segment", () => {
    expect(postedSpeedMphAt(route, 0)).toBe(35);
    expect(postedSpeedMphAt(route, 499)).toBe(35);
    expect(postedSpeedMphAt(route, 500)).toBe(55);
    expect(postedSpeedMphAt(route, 1500)).toBe(55);
    expect(postedSpeedMphAt(route, 2500)).toBe(65);
  });

  it("returns null when route has no samples", () => {
    expect(postedSpeedMphAt(undefined, 100)).toBeNull();
    expect(postedSpeedMphAt({}, 100)).toBeNull();
  });
});
