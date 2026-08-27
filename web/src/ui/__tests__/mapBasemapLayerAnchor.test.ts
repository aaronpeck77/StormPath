import { describe, expect, it } from "vitest";
import {
  firstBasemapSymbolLayerId,
  isBasemapRoadPavementLayer,
  isStormPathOverlayLayerId,
  moveLayerBelowBasemapLabels,
} from "../mapBasemapLayerAnchor";
import { createFakeMap } from "./fakeMapLayers";

describe("mapBasemapLayerAnchor", () => {
  it("skips StormPath overlays when naming overlay ids", () => {
    expect(isStormPathOverlayLayerId("route-r-a-line")).toBe(true);
    expect(isStormPathOverlayLayerId("mapbox-traffic-congestion-severe")).toBe(true);
    expect(isStormPathOverlayLayerId("road-label")).toBe(false);
  });

  it("treats streets-v12 road casings as pavement, not oneway arrows", () => {
    expect(isBasemapRoadPavementLayer({ id: "road-street", type: "line", "source-layer": "road" })).toBe(
      true
    );
    expect(
      isBasemapRoadPavementLayer({ id: "tunnel-oneway-arrow-blue", type: "symbol", "source-layer": "road" })
    ).toBe(false);
  });

  it("anchors on road-label even when an earlier symbol sits under the pavement", () => {
    const { map } = createFakeMap([
      { id: "tunnel-oneway-arrow-blue", type: "symbol" },
      { id: "road-street", type: "line" },
      { id: "bridge-motorway-trunk", type: "line" },
      { id: "radar-storm-motion-labels-text", type: "symbol" },
      { id: "road-label", type: "symbol" },
      { id: "poi-label", type: "symbol" },
    ]);
    expect(firstBasemapSymbolLayerId(map)).toBe("road-label");
  });

  it("parks the route on the pavement and under road names", () => {
    const { map, layers } = createFakeMap([
      { id: "tunnel-oneway-arrow-blue", type: "symbol" },
      { id: "road-street", type: "line" },
      { id: "road-label", type: "symbol" },
      { id: "poi-label", type: "symbol" },
      { id: "route-r-a-line", type: "line" },
    ]);
    moveLayerBelowBasemapLabels(map, "route-r-a-line");
    expect(layers.map((layer) => layer.id)).toEqual([
      "tunnel-oneway-arrow-blue",
      "road-street",
      "route-r-a-line",
      "road-label",
      "poi-label",
    ]);
  });
});
