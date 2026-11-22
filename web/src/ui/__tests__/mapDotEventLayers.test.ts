import { describe, expect, it } from "vitest";
import {
  applyDotEventLayers,
  DOT_EVENT_LAYER,
  DOT_EVENT_SRC,
  dotEventFeatureCollection,
  dotEventIconName,
  removeDotEventLayers,
} from "../mapDotEventLayers";
import type { DotMarkerInput } from "../dotMarkerPlacement";
import { isStormPathOverlayLayerId } from "../mapBasemapLayerAnchor";

const markers: DotMarkerInput[] = [
  {
    id: "dot:a",
    lngLat: [-93.65, 41.6],
    label: "I-80 work",
    kind: "construction",
  },
  {
    id: "dot:b",
    lngLat: [-93.5, 41.6],
    label: "Closure",
    kind: "closure",
  },
];

describe("dotEventFeatureCollection", () => {
  it("maps each marker to a point feature with kind icon", () => {
    const fc = dotEventFeatureCollection(markers);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-93.65, 41.6]);
    expect(fc.features[0]!.properties).toMatchObject({
      id: "dot:a",
      kind: "construction",
      icon: "sp-dot-construction",
      label: "I-80 work",
    });
    expect(fc.features[1]!.properties.icon).toBe("sp-dot-closure");
  });

  it("drops invalid coordinates and defaults missing kind to other", () => {
    const fc = dotEventFeatureCollection([
      { id: "bad", lngLat: [NaN, 41], label: "x" },
      { id: "ok", lngLat: [-90, 40], label: "y" },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties.kind).toBe("other");
    expect(fc.features[0]!.properties.icon).toBe(dotEventIconName("other"));
  });

  it("returns an empty collection for null/empty input", () => {
    expect(dotEventFeatureCollection(null).features).toEqual([]);
    expect(dotEventFeatureCollection([]).features).toEqual([]);
  });
});

/** hasImage() true keeps canvas icon drawing out of node-environment tests. */
function fakeMap() {
  const sources = new Map<string, { data: unknown; tolerance?: number }>();
  const layers = new Map<string, Record<string, unknown>>();
  return {
    sources,
    layers,
    getSource: (id: string) =>
      sources.has(id)
        ? { setData: (d: unknown) => sources.set(id, { ...(sources.get(id) ?? {}), data: d }) }
        : undefined,
    addSource: (id: string, src: { data: unknown; tolerance?: number }) =>
      sources.set(id, { data: src.data, tolerance: src.tolerance }),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer as Record<string, unknown>),
    removeLayer: (id: string) => layers.delete(id),
    hasImage: () => true,
    addImage: () => undefined,
  };
}

describe("applyDotEventLayers", () => {
  it("adds a geojson source with tolerance 0 and an overlapping symbol layer", () => {
    const map = fakeMap();
    applyDotEventLayers(map as never, markers);
    expect(map.sources.has(DOT_EVENT_SRC)).toBe(true);
    expect(map.sources.get(DOT_EVENT_SRC)?.tolerance).toBe(0);
    const layer = map.layers.get(DOT_EVENT_LAYER) as
      | { layout?: Record<string, unknown> }
      | undefined;
    expect(layer?.layout?.["icon-allow-overlap"]).toBe(true);
    expect(layer?.layout?.["icon-ignore-placement"]).toBe(true);
    expect(layer?.layout?.["icon-anchor"]).toBe("center");
  });

  it("clears the layer when markers are empty", () => {
    const map = fakeMap();
    applyDotEventLayers(map as never, markers);
    applyDotEventLayers(map as never, []);
    expect(map.layers.has(DOT_EVENT_LAYER)).toBe(false);
    expect(map.sources.has(DOT_EVENT_SRC)).toBe(false);
    removeDotEventLayers(map as never);
  });
});

describe("overlay id recognition", () => {
  it("treats DOT symbol layers as StormPath overlays", () => {
    expect(isStormPathOverlayLayerId(DOT_EVENT_LAYER)).toBe(true);
    expect(isStormPathOverlayLayerId(DOT_EVENT_SRC)).toBe(true);
  });
});
