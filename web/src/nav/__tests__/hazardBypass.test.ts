import { describe, expect, it } from "vitest";
import {
  bendAvailability,
  activeIndexAfterPullRemoved,
  activeIndexWithoutBends,
  baselineWithoutBends,
  nextHazardBendLabel,
  pullInsertIndex,
  viasWithPull,
  viasWithoutPull,
} from "../hazardBypass";
import type { TripStop } from "../routeWaypoints";
import type { LngLat } from "../types";

const line: LngLat[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 0],
];

const coffee: TripStop = { label: "Coffee", lngLat: [2, 0] };

const eligibility = {
  route: { id: "r", role: "fastest" as const, label: "Route", geometry: line, baseEtaMinutes: 20,
    turnSteps: [{ roadRef: "I-55", instruction: "Continue", distanceM: 20000 }] },
  alongMeters: 1000, navigationStarted: true, isOnline: true, metersToManeuver: 10000,
  items: [{ id: "closure", track: "road" as const, label: "Closed", severity: "avoid" as const,
    crossesRoute: true, startMeters: 10000, endMeters: 12000 }],
};

describe("contextual Bend availability", () => {
  it("offers manual access on sustained open roads and promotes a crossing hazard", () => {
    expect(bendAvailability(eligibility)).toEqual({ manual: true, hazardId: "closure" });
    expect(bendAvailability({ ...eligibility, items: [] })).toEqual({ manual: true, hazardId: null });
  });
  it("does not use total trip length or upcoming-road instruction text to qualify city streets", () => {
    const route = { ...eligibility.route, turnSteps: [{ roadName: "Main Street", instruction: "Turn onto I-55", distanceM: 100000 }] };
    expect(bendAvailability({ ...eligibility, route }).manual).toBe(false);
    expect(bendAvailability({ ...eligibility, route: { ...route, turnSteps: [] } }).manual).toBe(false);
  });
  it("requires five continuous miles, not separate short highway stretches", () => {
    const turnSteps = [
      { roadRef: "I-55", instruction: "Continue", distanceM: 4000 },
      { roadName: "Main Street", instruction: "Continue", distanceM: 1000 },
      { roadRef: "I-55", instruction: "Continue", distanceM: 4000 },
    ];
    expect(bendAvailability({ ...eligibility, route: { ...eligibility.route, turnSteps } }).manual).toBe(false);
  });
  it("requires a real high-speed sample for non-interstate highways", () => {
    const route = { ...eligibility.route, turnSteps: [{ roadRef: "US 36", instruction: "Continue", distanceM: 20000 }] };
    expect(bendAvailability({ ...eligibility, route }).manual).toBe(false);
    expect(bendAvailability({ ...eligibility, route: { ...route, postedSpeedSamples: [{ alongMeters: 0, mph: 55 }] } }).manual).toBe(true);
  });
  it.each([
    { crossesRoute: false }, { crossesRoute: undefined }, { etaStale: true }, { stripMuted: true },
    { coarsePreview: true }, { developingLater: true }, { severity: "caution" as const },
    { expiresIso: "2000-01-01" }, { expiresIso: "invalid" }, { startMeters: 500 },
    { endMeters: 0 }, { startMeters: 25000, endMeters: 26000 },
  ])("does not promote an unsuitable hazard: %j", (patch) => {
    expect(bendAvailability({ ...eligibility, items: [{ ...eligibility.items[0]!, ...patch }] }).hazardId).toBeNull();
  });
  it("defers promotion offline and near turns", () => {
    expect(bendAvailability({ ...eligibility, isOnline: false }).hazardId).toBeNull();
    expect(bendAvailability({ ...eligibility, metersToManeuver: 500 }).hazardId).toBeNull();
    expect(bendAvailability({ ...eligibility, navigationStarted: false }).manual).toBe(false);
  });
});

describe("hazard bypass pulls", () => {
  it("puts the first pull on the leg under the finger", () => {
    const before = viasWithPull([coffee], 0, line, [0.4, 0], [0.2, -1]);
    expect(before?.map((s) => s.label)).toEqual(["Hazard bend", "Coffee"]);
    expect(before?.[0]?.lngLat).toEqual([0.2, -1]);

    const after = viasWithPull([coffee], 0, line, [3.2, 0], [3.4, 1]);
    expect(after?.map((s) => s.label)).toEqual(["Coffee", "Hazard bend"]);
  });

  it("stops at two pulls", () => {
    const once = viasWithPull([], 0, line, [1, 0], [1, -1]);
    const twice = viasWithPull(once!, 0, line, [3, 0], [3, 1]);
    expect(twice?.map((s) => s.label)).toEqual(["Hazard bend", "Hazard bend 2"]);
    expect(nextHazardBendLabel(twice!)).toBeNull();
    expect(viasWithPull(twice!, 0, line, [2, 0], [2, 1])).toBeNull();
  });

  it("undo removes one pull and leaves the stop that was already on the trip", () => {
    const bent = viasWithPull([coffee], 0, line, [3, 0], [3, 1])!;
    const undone = viasWithoutPull(bent, "Hazard bend");
    expect(undone?.vias).toEqual([coffee]);
    expect(activeIndexAfterPullRemoved(0, undone!.removedIndex)).toBe(0);
  });

  it("cancel baseline drops bends and keeps a stop the car has not passed", () => {
    const vias: TripStop[] = [
      coffee,
      { label: "Hazard bend", lngLat: [3, 1] },
    ];
    expect(baselineWithoutBends(vias)).toEqual([coffee]);
    expect(activeIndexWithoutBends(vias, 0)).toBe(0);
    expect(activeIndexWithoutBends(vias, 1)).toBe(1);
  });

  it("does not insert a new pull ahead of a stop the car already passed", () => {
    const passed = pullInsertIndex([coffee], 1, line, [0.2, 0]);
    expect(passed).toBe(1);
  });
});
