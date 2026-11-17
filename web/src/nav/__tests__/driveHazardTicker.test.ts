import { describe, expect, it } from "vitest";
import {
  selectDriveHazardQueue,
  selectNextDriveHazardItem,
  selectDriveHazardTicker,
  type DriveHazardTickerInput,
} from "../driveHazardTicker";
import type { TimelineItem } from "../routeAheadSync";

const hazard: TimelineItem = {
  /* ~4 mi ahead of userAlongMeters — inside the iPad queue's uncapped window. */
  id: "storm", track: "nws", label: "Severe Thunderstorm Warning", severity: "serious",
  startMeters: 9665, endMeters: 20000, crossesRoute: true,
};
const input: DriveHazardTickerInput = {
  items: [hazard], isPlus: true, isOnline: true, navigationStarted: true,
  viewMode: "drive", userAlongMeters: 3218.68, metersToManeuver: 10000, miles: true,
};

/* Phone countdown fixture — hazard ~0.5 mi ahead, inside the 1 mi window. */
const nearHazard: TimelineItem = {
  id: "storm", track: "nws", label: "Severe Thunderstorm Warning", severity: "serious",
  startMeters: 4000, endMeters: 20000, crossesRoute: true,
};
const nearInput: DriveHazardTickerInput = { ...input, items: [nearHazard] };

describe("Drive hazard countdown", () => {
  it("counts down along the route rather than straight-line distance", () => {
    expect(selectDriveHazardTicker(nearInput)?.distanceLabel).toBe("0.5 mi");
    expect(
      selectDriveHazardTicker({ ...nearInput, userAlongMeters: 3700 })?.distanceLabel
    ).toBe("0.2 mi");
  });

  it("arms the countdown only inside ~1 mi", () => {
    const inside = { ...nearHazard, startMeters: 3218.68 + 0.9 * 1609.34 };
    const outside = { ...nearHazard, startMeters: 3218.68 + 1.1 * 1609.34 };
    expect(selectDriveHazardTicker({ ...nearInput, items: [inside] })?.mode).toBe("countdown");
    expect(selectDriveHazardTicker({ ...nearInput, items: [outside] })).toBeNull();
    /* The iPad queue/panel stays uncapped — same far hazard still counts down there. */
    expect(
      selectDriveHazardQueue({ ...input, totalMeters: 30000, items: [outside] })[0]?.id
    ).toBe(hazard.id);
  });

  it.each([
    { isPlus: false }, { isOnline: false }, { navigationStarted: false }, { offRoute: true },
    { viewMode: "route" as const }, { viewMode: "topdown" as const },
    { metersToManeuver: 500 }, { metersToManeuver: null },
    { userAlongMeters: NaN }, { metersToManeuver: NaN },
  ])("hides outside eligible Drive cruising: %j", (patch) => {
    expect(selectDriveHazardTicker({ ...nearInput, ...patch })).toBeNull();
  });

  it("shows an active hazard, then removes it after passing its end", () => {
    expect(selectDriveHazardTicker({ ...nearInput, userAlongMeters: 17000 })?.distanceLabel).toBe("Here now");
    expect(selectDriveHazardTicker({ ...nearInput, userAlongMeters: 20000 })).toBeNull();
  });

  it("chooses the closest hazard and severity breaks ties", () => {
    const road: TimelineItem = { ...nearHazard, id: "road", track: "road", label: "Road closure", startMeters: 3300, endMeters: 4000 };
    expect(selectDriveHazardTicker({ ...nearInput, items: [nearHazard, road] })?.id).toBe("road");
    expect(selectDriveHazardTicker({ ...nearInput, items: [road, { ...road, id: "urgent", severity: "avoid" }] })?.id).toBe("urgent");
  });

  it.each([
    { crossesRoute: false }, { stripMuted: true }, { coarsePreview: true },
    { etaStale: true }, { severity: "info" as const }, { startMeters: NaN },
    { endMeters: Infinity }, { startMeters: 21000 }, { label: " " },
    { expiresIso: "2000-01-01T00:00:00Z" }, { expiresIso: "invalid" },
  ])("excludes irrelevant, expired or invalid hazards: %j", (patch) => {
    expect(selectDriveHazardTicker({ ...nearInput, items: [{ ...nearHazard, ...patch }] })).toBeNull();
  });

  it("uses kilometers where appropriate and qualifies developing hazards", () => {
    const result = selectDriveHazardTicker({ ...nearInput, miles: false, items: [{ ...nearHazard, developingLater: true }] });
    expect(result?.distanceLabel).toBe("0.8 km");
    expect(result?.label).toBe("Possible: Severe Thunderstorm Warning");
  });

  it("does not round an approaching hazard to zero miles", () => {
    expect(selectDriveHazardTicker({ ...nearInput, userAlongMeters: nearHazard.startMeters - 20 })?.distanceLabel).toBe("<0.1 mi");
  });

  it("flashes instead of counting down when the last hazard just ended", () => {
    /* Hazard cluster: previous hazard ended ~0.1 mi behind — the next one is
     * "right behind" it, so it earns a flash mention, not a countdown. */
    const passed: TimelineItem = {
      id: "passed", track: "road", label: "Work zone", severity: "caution",
      startMeters: 2000, endMeters: 3100, crossesRoute: true,
    };
    const clustered = selectDriveHazardTicker({ ...nearInput, items: [passed, nearHazard] });
    expect(clustered?.id).toBe("storm");
    expect(clustered?.mode).toBe("flash");
    /* A few clear miles behind → the same hazard counts down normally. */
    const clear = selectDriveHazardTicker({
      ...nearInput,
      userAlongMeters: 15000,
      items: [
        { ...passed, startMeters: 8000, endMeters: 9000 },
        { ...nearHazard, startMeters: 16000, endMeters: 17000 },
      ],
    });
    expect(clear?.mode).toBe("countdown");
  });

  it("keeps flashing through a tight cluster, then counts down after clear miles", () => {
    /* Two hazards ~0.3 mi apart: after passing the first, the second flashes
     * because the clear run-up never reached a few miles. */
    const first: TimelineItem = {
      id: "first", track: "road", label: "Work zone", severity: "caution",
      startMeters: 2000, endMeters: 3050, crossesRoute: true,
    };
    const second: TimelineItem = { ...nearHazard, id: "second", startMeters: 3600, endMeters: 3900 };
    const flashed = selectDriveHazardTicker({ ...nearInput, items: [first, second], userAlongMeters: 3100 });
    expect(flashed?.id).toBe("second");
    expect(flashed?.mode).toBe("flash");
    /* Muted/info hazards behind don't break the clear run-up. */
    const mutedBehind: TimelineItem = { ...first, id: "muted", stripMuted: true, endMeters: 3090 };
    const solo = selectDriveHazardTicker({ ...nearInput, items: [mutedBehind, second], userAlongMeters: 3100 });
    expect(solo?.mode).toBe("countdown");
  });
});

describe("Drive hazard queue (iPad landscape panel)", () => {
  const queueInput = {
    ...input,
    totalMeters: 80467,
    planEtaMinutes: 90,
    driveEtaMinutes: 80,
  };

  it("returns up to two hazards, nearest first", () => {
    const farther: TimelineItem = {
      ...hazard, id: "far", label: "Flood Advisory",
      startMeters: 40000, endMeters: 45000,
    };
    const rows = selectDriveHazardQueue({ ...queueInput, items: [farther, hazard] });
    expect(rows.map((r) => r.id)).toEqual(["storm", "far"]);
    expect(rows[0].distanceLabel).toBe("4.0 mi");
    expect(rows[1].distanceLabel).toBe("23 mi");
  });

  it("includes an ETA estimate when trip timing is available", () => {
    const rows = selectDriveHazardQueue(queueInput);
    expect(rows).toHaveLength(1);
    expect(rows[0].etaLabel).toBeTruthy();
  });

  it("omits ETA when timing inputs are missing", () => {
    const rows = selectDriveHazardQueue(input);
    expect(rows[0].etaLabel).toBeNull();
  });

  it("respects the same eligibility gates as the ticker", () => {
    expect(selectDriveHazardQueue({ ...queueInput, isPlus: false })).toEqual([]);
    expect(selectDriveHazardQueue({ ...queueInput, viewMode: "route" })).toEqual([]);
  });

  it("counts down the same set the route-info graph shows", () => {
    // Strip-muted NWS still paints on the graph's NWS rail → countdown includes it.
    const mutedNws = { ...hazard, id: "muted-nws", stripMuted: true };
    expect(selectDriveHazardQueue({ ...queueInput, items: [mutedNws] })[0]?.id).toBe("muted-nws");
    // Road hazards show caution+ on the graph — same rule as the drive line,
    // so a painted work zone can never leave every list saying "all clear".
    const cautionRoad = {
      ...hazard, id: "road-caution", track: "road" as const, severity: "caution" as const,
    };
    expect(selectDriveHazardQueue({ ...queueInput, items: [cautionRoad] })[0]?.id).toBe("road-caution");
    const infoRoad = { ...cautionRoad, id: "road-info", severity: "info" as const };
    expect(selectDriveHazardQueue({ ...queueInput, items: [infoRoad] })).toEqual([]);
    const seriousRoad = { ...cautionRoad, id: "road-serious", severity: "serious" as const };
    expect(selectDriveHazardQueue({ ...queueInput, items: [seriousRoad] })[0]?.id).toBe("road-serious");
  });

  it("selectNextDriveHazardItem returns the countdown's next TimelineItem", () => {
    const item = selectNextDriveHazardItem({ ...queueInput, items: [hazard] });
    expect(item?.id).toBe("storm");
    expect(item?.startMeters).toBe(hazard.startMeters);
    expect(selectNextDriveHazardItem({ ...queueInput, items: [] })).toBeNull();
  });

  it("anyNavView keeps the next-hazard highlight alive outside drive view", () => {
    const mp = { ...queueInput, viewMode: "topdown" as const, items: [hazard] };
    // Countdown queue stays drive-only by default…
    expect(selectDriveHazardQueue(mp)).toEqual([]);
    expect(selectNextDriveHazardItem(mp)).toBeNull();
    // …but the iPad panel opts into every nav view, and the shared "next" used
    // for page highlights + the route beacon does not.
    expect(selectDriveHazardQueue(mp, Date.now(), { anyNavView: true })[0]?.id).toBe("storm");
    expect(selectNextDriveHazardItem(mp, { anyNavView: true })?.id).toBe("storm");
  });

  it("anyNavView drops the next-turn gate — city-block hazards still count down", () => {
    /* The phone ticker stays quiet inside ~1 mi of a turn; the iPad panel
     * shows every hazard ahead on the route (Bill, 588). */
    const nearTurn = { ...queueInput, metersToManeuver: 500, items: [hazard] };
    expect(selectDriveHazardTicker(nearTurn)).toBeNull();
    expect(selectDriveHazardQueue(nearTurn, Date.now(), { anyNavView: true })[0]?.id).toBe("storm");
    expect(selectNextDriveHazardItem(nearTurn, { anyNavView: true })?.id).toBe("storm");
    const noTurn = { ...queueInput, metersToManeuver: null, items: [hazard] };
    expect(selectDriveHazardQueue(noTurn, Date.now(), { anyNavView: true })[0]?.id).toBe("storm");
  });
});
