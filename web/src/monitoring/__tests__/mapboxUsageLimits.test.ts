import { describe, expect, it } from "vitest";
import {
  addMapboxUsageCounters,
  clampUsageDeltas,
  emptyMapboxUsageCounters,
  usagePct,
  usageWarnLevel,
} from "../mapboxUsageLimits";

describe("mapboxUsageLimits", () => {
  it("adds counters", () => {
    const a = emptyMapboxUsageCounters();
    a.directions = 10;
    expect(addMapboxUsageCounters(a, { directions: 5, geocoding: 2 })).toEqual({
      directions: 15,
      geocoding: 2,
      matching: 0,
      navTrips: 0,
      searchBox: 0,
    });
  });

  it("clamps ingest deltas", () => {
    expect(clampUsageDeltas({ directions: 9999 }, 200).directions).toBe(200);
    expect(clampUsageDeltas({ directions: -3 }).directions).toBe(0);
  });

  it("maps free-tier percent to warn levels", () => {
    expect(usagePct(70_000, 100_000)).toBe(70);
    expect(usageWarnLevel(69)).toBe("ok");
    expect(usageWarnLevel(70)).toBe("warn");
    expect(usageWarnLevel(90)).toBe("bad");
  });
});
