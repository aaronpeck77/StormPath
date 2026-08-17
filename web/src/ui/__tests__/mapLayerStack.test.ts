import { describe, expect, it } from "vitest";
import { liftTrafficThenRoutesThenHits } from "../mapLayerStack";
import { createFakeMap } from "./fakeMapLayers";

describe("liftTrafficThenRoutesThenHits", () => {
  it("keeps solid route and traffic lines under road-name labels", () => {
    const { map, layers } = createFakeMap([
      { id: "land", type: "fill" },
      { id: "road-street", type: "line" },
      { id: "road-label", type: "symbol" },
      { id: "poi-label", type: "symbol" },
      { id: "mapbox-traffic-congestion-mh", type: "line" },
      { id: "mapbox-traffic-congestion-severe", type: "line" },
      { id: "mapbox-traffic-closed", type: "line" },
      { id: "route-r-a-line-casing", type: "line" },
      { id: "route-r-a-line", type: "line" },
      { id: "route-r-a-line-hit", type: "line" },
    ]);

    liftTrafficThenRoutesThenHits(map, ["r-a"], "route", "r-a");

    const ids = layers.map((layer) => layer.id);
    const roadLabel = ids.indexOf("road-label");
    expect(ids.indexOf("route-r-a-line")).toBeLessThan(roadLabel);
    expect(ids.indexOf("route-r-a-line-casing")).toBeLessThan(ids.indexOf("route-r-a-line"));
    expect(ids.indexOf("mapbox-traffic-congestion-severe")).toBeLessThan(ids.indexOf("route-r-a-line"));
    expect(ids.indexOf("mapbox-traffic-congestion-severe")).toBeLessThan(roadLabel);
    expect(ids.indexOf("route-r-a-line-hit")).toBeGreaterThan(ids.indexOf("poi-label"));
  });

  it("puts the focused route above an alternate, still under labels", () => {
    const { map, layers } = createFakeMap([
      { id: "road-street", type: "line" },
      { id: "road-label", type: "symbol" },
      { id: "route-r-a-line-casing", type: "line" },
      { id: "route-r-a-line", type: "line" },
      { id: "route-r-b-line-casing", type: "line" },
      { id: "route-r-b-line", type: "line" },
    ]);

    liftTrafficThenRoutesThenHits(map, ["r-a", "r-b"], "route", "r-a");

    const ids = layers.map((layer) => layer.id);
    expect(ids.indexOf("route-r-b-line")).toBeLessThan(ids.indexOf("route-r-a-line"));
    expect(ids.indexOf("route-r-a-line")).toBeLessThan(ids.indexOf("road-label"));
  });
});
