import { describe, expect, it } from "vitest";
import { selectDriveHazardTicker, type DriveHazardTickerInput } from "../driveHazardTicker";
import type { TimelineItem } from "../routeAheadSync";

const hazard: TimelineItem = {
  id: "storm", track: "nws", label: "Severe Thunderstorm Warning", severity: "serious",
  startMeters: 16093.4, endMeters: 20000, crossesRoute: true,
};
const input: DriveHazardTickerInput = {
  items: [hazard], isPlus: true, isOnline: true, navigationStarted: true,
  viewMode: "drive", userAlongMeters: 3218.68, metersToManeuver: 10000, miles: true,
};

describe("Drive hazard countdown", () => {
  it("counts down along the route rather than straight-line distance", () => {
    expect(selectDriveHazardTicker(input)?.distanceLabel).toBe("8.0 mi");
    expect(selectDriveHazardTicker({ ...input, userAlongMeters: 6437.36 })?.distanceLabel).toBe("6.0 mi");
  });

  it.each([
    { isPlus: false }, { isOnline: false }, { navigationStarted: false }, { offRoute: true },
    { viewMode: "route" as const }, { viewMode: "topdown" as const },
    { metersToManeuver: 500 }, { metersToManeuver: null },
    { userAlongMeters: NaN }, { metersToManeuver: NaN },
  ])("hides outside eligible Drive cruising: %j", (patch) => {
    expect(selectDriveHazardTicker({ ...input, ...patch })).toBeNull();
  });

  it("shows an active hazard, then removes it after passing its end", () => {
    expect(selectDriveHazardTicker({ ...input, userAlongMeters: 17000 })?.distanceLabel).toBe("Here now");
    expect(selectDriveHazardTicker({ ...input, userAlongMeters: 20000 })).toBeNull();
  });

  it("chooses the closest hazard and severity breaks ties", () => {
    const road: TimelineItem = { ...hazard, id: "road", track: "road", label: "Road closure", startMeters: 10000, endMeters: 11000 };
    expect(selectDriveHazardTicker({ ...input, items: [hazard, road] })?.id).toBe("road");
    expect(selectDriveHazardTicker({ ...input, items: [road, { ...road, id: "urgent", severity: "avoid" }] })?.id).toBe("urgent");
  });

  it.each([
    { crossesRoute: false }, { stripMuted: true }, { coarsePreview: true },
    { etaStale: true }, { severity: "info" as const }, { startMeters: NaN },
    { endMeters: Infinity }, { startMeters: 21000 }, { label: " " },
    { expiresIso: "2000-01-01T00:00:00Z" }, { expiresIso: "invalid" },
  ])("excludes irrelevant, expired or invalid hazards: %j", (patch) => {
    expect(selectDriveHazardTicker({ ...input, items: [{ ...hazard, ...patch }] })).toBeNull();
  });

  it("uses kilometers where appropriate and qualifies developing hazards", () => {
    const result = selectDriveHazardTicker({ ...input, miles: false, items: [{ ...hazard, developingLater: true }] });
    expect(result?.distanceLabel).toBe("13 km");
    expect(result?.label).toBe("Possible: Severe Thunderstorm Warning");
  });

  it("does not round an approaching hazard to zero miles", () => {
    expect(selectDriveHazardTicker({ ...input, userAlongMeters: hazard.startMeters - 20 })?.distanceLabel).toBe("<0.1 mi");
  });
});
