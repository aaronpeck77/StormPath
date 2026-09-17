import { describe, expect, it } from "vitest";
import {
  collectRoadControls,
  displayedRoadControls,
  MAX_ROAD_CONTROLS,
  ROAD_CONTROL_DISPLAY_KINDS,
} from "../roadControls";

describe("collectRoadControls", () => {
  it("pulls signals, stops, yields and rail crossings off intersections", () => {
    const controls = collectRoadControls([
      {
        steps: [
          {
            intersections: [
              { location: [-89.1, 39.8], traffic_signal: true },
              { location: [-89.11, 39.81], stop_sign: true },
              { location: [-89.12, 39.82], yield_sign: true },
              { location: [-89.13, 39.83], railway_crossing: true },
              { location: [-89.14, 39.84] },
            ],
          },
        ],
      },
    ]);
    expect(controls).toEqual([
      { lngLat: [-89.1, 39.8], kind: "traffic_signal" },
      { lngLat: [-89.11, 39.81], kind: "stop_sign" },
      { lngLat: [-89.12, 39.82], kind: "yield_sign" },
      { lngLat: [-89.13, 39.83], kind: "railway_crossing" },
    ]);
  });

  it("prefers the signal when a node is flagged twice", () => {
    const controls = collectRoadControls([
      { steps: [{ intersections: [{ location: [-89.1, 39.8], traffic_signal: true, stop_sign: true }] }] },
    ]);
    expect(controls).toEqual([{ lngLat: [-89.1, 39.8], kind: "traffic_signal" }]);
  });

  it("drops the shared node repeated by adjacent steps", () => {
    const controls = collectRoadControls([
      {
        steps: [
          { intersections: [{ location: [-89.1, 39.8], traffic_signal: true }] },
          { intersections: [{ location: [-89.1, 39.8], traffic_signal: true }] },
        ],
      },
    ]);
    expect(controls).toHaveLength(1);
  });

  it("ignores junk coordinates and returns undefined with nothing to show", () => {
    expect(
      collectRoadControls([
        {
          steps: [
            { intersections: [{ location: [Number.NaN, 39.8], traffic_signal: true }] },
            { intersections: [{ traffic_signal: true }] },
            { intersections: [{ location: [-89.1], stop_sign: true }] },
          ],
        },
      ])
    ).toBeUndefined();
    expect(collectRoadControls(undefined)).toBeUndefined();
    expect(collectRoadControls([])).toBeUndefined();
  });

  it("caps a city-heavy plan", () => {
    const intersections = Array.from({ length: MAX_ROAD_CONTROLS + 50 }, (_, i) => ({
      location: [-89 - i / 10000, 39.8],
      traffic_signal: true,
    }));
    expect(collectRoadControls([{ steps: [{ intersections }] }])).toHaveLength(MAX_ROAD_CONTROLS);
  });
});

describe("displayedRoadControls", () => {
  /** OSM tags most signals and rail crossings, but few residential stop signs. */
  it("draws only the kinds whose data is trustworthy", () => {
    const drawn = displayedRoadControls([
      { lngLat: [-89.1, 39.8], kind: "traffic_signal" },
      { lngLat: [-89.11, 39.81], kind: "stop_sign" },
      { lngLat: [-89.12, 39.82], kind: "yield_sign" },
      { lngLat: [-89.13, 39.83], kind: "railway_crossing" },
    ]);
    expect(drawn.map((p) => p.kind)).toEqual(["traffic_signal", "railway_crossing"]);
    expect(ROAD_CONTROL_DISPLAY_KINDS).not.toContain("stop_sign");
  });

  it("handles an empty or missing corridor", () => {
    expect(displayedRoadControls(undefined)).toEqual([]);
    expect(displayedRoadControls(null)).toEqual([]);
    expect(displayedRoadControls([{ lngLat: [-89.1, 39.8], kind: "stop_sign" }])).toEqual([]);
  });
});
