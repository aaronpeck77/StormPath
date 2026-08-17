import { describe, expect, it } from "vitest";
import {
  firstBasemapSymbolLayerId,
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

  it("finds the first Mapbox symbol layer, not StormPath symbols", () => {
    const { map } = createFakeMap([
      { id: "road-street", type: "line" },
      { id: "radar-storm-motion-labels-text", type: "symbol" },
      { id: "road-label", type: "symbol" },
      { id: "poi-label", type: "symbol" },
    ]);
    expect(firstBasemapSymbolLayerId(map)).toBe("road-label");
  });

  it("parks a solid route line under road names instead of lifting it to the top", () => {
    const { map, layers } = createFakeMap([
      { id: "road-street", type: "line" },
      { id: "road-label", type: "symbol" },
      { id: "poi-label", type: "symbol" },
      { id: "route-r-a-line", type: "line" },
    ]);
    moveLayerBelowBasemapLabels(map, "route-r-a-line");
    expect(layers.map((layer) => layer.id)).toEqual([
      "road-street",
      "route-r-a-line",
      "road-label",
      "poi-label",
    ]);
  });
});
