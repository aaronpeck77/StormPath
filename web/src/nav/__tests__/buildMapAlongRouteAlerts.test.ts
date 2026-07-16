import { describe, expect, it } from "vitest";
import { buildMapAlongRouteAlerts } from "../buildMapAlongRouteAlerts";
import type { RouteAlert } from "../routeAlerts";

function alert(id: string, severity: number): RouteAlert {
  return {
    id,
    severity,
    title: id,
    detail: "",
    lngLat: [0, 0],
    zoom: 10,
    alongMeters: 1000,
    promptRerouteAhead: false,
    corridorKind: "hazard",
  };
}

describe("buildMapAlongRouteAlerts", () => {
  it("returns empty without guidance geometry", () => {
    expect(
      buildMapAlongRouteAlerts({
        guidanceGeometry: null,
        progressStripAlerts: [alert("a", 90)],
        routeAheadTimeline: [],
        advisoryRouteImpacts: [],
      })
    ).toEqual([]);
  });

  it("keeps only route-line-eligible strip alerts and dedupes by id", () => {
    const out = buildMapAlongRouteAlerts({
      guidanceGeometry: [
        [0, 0],
        [1, 1],
      ],
      progressStripAlerts: [alert("keep", 90), alert("keep", 90), alert("quiet", 40)],
      routeAheadTimeline: [],
      advisoryRouteImpacts: [],
    });
    expect(out.map((a) => a.id)).toEqual(["keep"]);
  });
});
