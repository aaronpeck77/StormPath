import { describe, expect, it } from "vitest";
import {
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
