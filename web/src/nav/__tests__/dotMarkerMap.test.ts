import { describe, expect, it } from "vitest";
import {
  buildDotImpacts,
  matchDotEventsToRoute,
  dotMatchesToImpacts,
} from "../dotImpacts";
import {
  dotMarkersAlongFocusGeometry,
  focusGeometryForDotMatch,
} from "../dotMarkerMap";
import { haversineMeters, pointAtAlongMeters } from "../routeGeometry";
import { resolveDotMarkerPlacement } from "../../ui/dotMarkerPlacement";
import type { DotRoadEvent } from "../../services/dotRoadEvents";
import type { RouteImpact } from "../routeImpacts";
import type { LngLat } from "../types";

/** Trip A — north–south (I-57 style). */
const TRIP_A_NS: LngLat[] = Array.from({ length: 30 }, (_, i) => [
  -89.1,
  40.0 - i * 0.05,
]);

/** Trip B — east–west (SD→IL style). */
const TRIP_B_EW: LngLat[] = Array.from({ length: 40 }, (_, i) => [
  -98.0 + i * 0.15,
  41.6,
]);

function makeEvent(point: LngLat, id: string): DotRoadEvent {
  return {
    id,
    state: "IL",
    publisher: "IDOT",
    kind: "construction",
    status: "active",
    title: "Work zone",
    roadName: "I-57",
    direction: null,
    description: "Construction",
    restrictionsText: null,
    lanesClosed: 1,
    vehicleImpact: null,
    startIso: null,
    endIso: null,
    point,
    bbox: [point[0] - 0.01, point[1] - 0.01, point[0] + 0.01, point[1] + 0.01],
    geometry: { type: "Point", coordinates: point },
  };
}

describe("dotMarkersAlongFocusGeometry", () => {
  it("reprojects from alongMeters onto the focus polyline, ignoring stale lngLat", () => {
    const focus = TRIP_B_EW;
    const alongM = 50_000;
    const onFocus = pointAtAlongMeters(focus, alongM);
    const staleGulf: LngLat = [-89.1, 18.0];
    const impacts: RouteImpact[] = [
      {
        id: "dot:stale",
        category: "construction",
        severity: "caution",
        confidence: "high",
        source: "dot511",
        lngLat: staleGulf,
        alongMeters: alongM,
        startMeters: alongM,
        endMeters: alongM,
        distanceAheadMeters: alongM,
        etaAheadMinutes: null,
        driverHeadline: "Work zone",
        driverAction: "slow",
        roadEffect: "unknown",
        detail: "",
        numericSeverity: 1,
        hazardOnsetIso: null,
        hazardExpiresIso: null,
        crossesRoute: true,
      },
    ];
    const markers = dotMarkersAlongFocusGeometry(impacts, focus);
    expect(markers).toHaveLength(1);
    expect(haversineMeters(markers[0]!.lngLat, onFocus)).toBeLessThan(5);
    expect(haversineMeters(markers[0]!.lngLat, staleGulf)).toBeGreaterThan(1_000_000);
  });

  it("returns nothing without a usable focus geometry", () => {
    expect(dotMarkersAlongFocusGeometry([], null)).toEqual([]);
    expect(dotMarkersAlongFocusGeometry([], [[-90, 40]])).toEqual([]);
  });
});

describe("focusGeometryForDotMatch", () => {
  it("uses nav guidance when navigating the guidance slot", () => {
    const nav: LngLat[] = [
      [-90, 41],
      [-89, 41],
    ];
    const plan = [{ id: "r-a", geometry: TRIP_B_EW }];
    const g = focusGeometryForDotMatch({
      navigationStarted: true,
      focusId: "r-a",
      guidanceRouteId: "r-a",
      navigationGuidanceGeometry: nav,
      planRoutes: plan,
    });
    expect(g).toBe(nav);
  });

  it("uses the plan focus leg when not navigating", () => {
    const plan = [
      { id: "r-a", geometry: TRIP_B_EW },
      { id: "r-b", geometry: TRIP_A_NS },
    ];
    const g = focusGeometryForDotMatch({
      navigationStarted: false,
      focusId: "r-a",
      guidanceRouteId: "r-a",
      navigationGuidanceGeometry: TRIP_A_NS,
      planRoutes: plan,
    });
    expect(g).toBe(TRIP_B_EW);
  });
});

describe("Guatemala column regression", () => {
  it("trip B rematch + reproject keeps markers on the E–W line, not the stale N–S corridor", () => {
    /* Events that sit on Trip A (N–S). */
    const events = [
      makeEvent([-89.1, 39.5], "A1"),
      makeEvent([-89.1, 38.5], "A2"),
      makeEvent([-89.1, 37.5], "A3"),
    ];

    /* Wrong: match onto Trip A — positions form a N–S column. */
    const staleImpacts = buildDotImpacts(events, TRIP_A_NS, 0);
    expect(staleImpacts.length).toBeGreaterThan(0);
    for (const i of staleImpacts) {
      expect(Math.abs(i.lngLat[0] - -89.1)).toBeLessThan(0.02);
    }

    /* Right: rematch onto Trip B. Events far from B drop; any survivors
     * land on B. Then map markers reproject along B. */
    const rematch = matchDotEventsToRoute(events, TRIP_B_EW);
    const rematchedImpacts = dotMatchesToImpacts(rematch, 0);

    /* Also cover the map path: even if impacts still carry stale lngLat
     * from Trip A alongMeters remapped via a fresh B match, markers use
     * alongMeters on B. Simulate rematch producing B alongMeters. */
    const bAlongImpacts: RouteImpact[] = staleImpacts.map((i, idx) => ({
      ...i,
      /* Deliberately leave stale Gulf/N–S lngLat; alongMeters as if rematched. */
      lngLat: [-89.1, 20 - idx] as LngLat,
      alongMeters: (idx + 1) * 80_000,
    }));
    const markers = dotMarkersAlongFocusGeometry(bAlongImpacts, TRIP_B_EW);
    expect(markers.length).toBe(bAlongImpacts.length);
    for (const m of markers) {
      expect(Math.abs(m.lngLat[1] - 41.6)).toBeLessThan(0.02);
      expect(m.lngLat[1]).toBeGreaterThan(30);
    }

    /* Placement with focus = Trip B must not pick a leftover N–S paint. */
    const painted = new Map<string, LngLat[]>([
      ["r-stale", TRIP_A_NS],
      ["r-a", TRIP_B_EW],
    ]);
    const placed = resolveDotMarkerPlacement(painted, markers, "r-a");
    expect(placed.paintedId).toBe("r-a");
    for (const m of placed.markers) {
      expect(Math.abs(m.lngLat[1] - 41.6)).toBeLessThan(0.05);
    }

    void rematchedImpacts;
  });
});
