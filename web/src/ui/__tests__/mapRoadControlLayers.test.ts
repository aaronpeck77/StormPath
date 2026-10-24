import { describe, expect, it } from "vitest";
import {
  applyRoadControlLayers,
  ROAD_CONTROL_LAYER,
  ROAD_CONTROL_SRC,
  roadControlFeatureCollection,
} from "../mapRoadControlLayers";
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

/** hasImage() true keeps icon drawing (canvas) out of these node-environment tests. */
function fakeMap() {
  const sources = new Map<string, { data: unknown }>();
  const layers = new Map<string, Record<string, unknown>>();
  return {
    sources,
    layers,
    getSource: (id: string) =>
      sources.has(id)
        ? { setData: (d: unknown) => sources.set(id, { data: d }) }
        : undefined,
    addSource: (id: string, src: { data: unknown }) => sources.set(id, { data: src.data }),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer as Record<string, unknown>),
    removeLayer: (id: string) => layers.delete(id),
    hasImage: () => true,
    addImage: () => undefined,
  };
}

describe("applyRoadControlLayers", () => {
  it("draws signals over basemap labels instead of losing the collision fight", () => {
    const map = fakeMap();
    applyRoadControlLayers(map as never, [{ lngLat: [-89.1, 39.8], kind: "traffic_signal" }]);
    const layer = map.layers.get(ROAD_CONTROL_LAYER) as
      | { layout?: Record<string, unknown> }
      | undefined;
    expect(map.sources.has(ROAD_CONTROL_SRC)).toBe(true);
    /* Both flags are required — placement runs bottom-up and this layer is last. */
    expect(layer?.layout?.["icon-allow-overlap"]).toBe(true);
    expect(layer?.layout?.["icon-ignore-placement"]).toBe(true);
  });

  it("clears the layer when the corridor has no controls", () => {
    const map = fakeMap();
    applyRoadControlLayers(map as never, [{ lngLat: [-89.1, 39.8], kind: "stop_sign" }]);
    applyRoadControlLayers(map as never, null);
    expect(map.layers.has(ROAD_CONTROL_LAYER)).toBe(false);
    expect(map.sources.has(ROAD_CONTROL_SRC)).toBe(false);
  });
});
