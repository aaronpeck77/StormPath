import { describe, expect, it } from "vitest";
import { roadControlFeatureCollection } from "../mapRoadControlLayers";
import type { RoadControlPoint } from "../../nav/types";

describe("roadControlFeatureCollection", () => {
  it("maps each control to a point feature with its icon", () => {
    const points: RoadControlPoint[] = [
      { lngLat: [-89.1, 39.8], kind: "traffic_signal" },
      { lngLat: [-89.2, 39.9], kind: "railway_crossing" },
    ];
    const fc = roadControlFeatureCollection(points);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-89.1, 39.8] },
      properties: { kind: "traffic_signal", icon: "sp-control-signal" },
    });
    expect(fc.features[1]!.properties.icon).toBe("sp-control-rail");
  });

  it("skips unusable coordinates and handles an empty corridor", () => {
    const fc = roadControlFeatureCollection([
      { lngLat: [Number.NaN, 39.8], kind: "stop_sign" },
      { lngLat: [-89.1, 39.8], kind: "stop_sign" },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(roadControlFeatureCollection(null).features).toEqual([]);
    expect(roadControlFeatureCollection(undefined).features).toEqual([]);
  });
});
