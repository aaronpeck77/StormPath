import { describe, expect, it } from "vitest";
import {
  buildDotImpacts,
  reconcileDotMapboxImpacts,
} from "../dotImpacts";
import type { DotRoadEvent } from "../../services/dotRoadEvents";
import type { RouteImpact } from "../routeImpacts";
import type { LngLat } from "../types";

/** Straight east-west route ~10 km long near Des Moines. */
const ROUTE: LngLat[] = [
  [-93.7, 41.6],
  [-93.6, 41.6],
];

function makeEvent(over: Partial<DotRoadEvent> = {}): DotRoadEvent {
  return {
    id: "IA:test-1",
    state: "IA",
    publisher: "Iowa DOT",
    kind: "construction",
    status: "active",
    title: "I-80 · Work zone",
    roadName: "I-80",
    direction: "eastbound",
    description: "Road construction work is in progress.",
    restrictionsText: null,
    lanesClosed: 0,
    vehicleImpact: "all-lanes-open",
    startIso: "2026-01-01T00:00:00Z",
    endIso: "2026-12-31T00:00:00Z",
    point: [-93.65, 41.6],
    bbox: [-93.651, 41.599, -93.649, 41.601],
    geometry: { type: "Point", coordinates: [-93.65, 41.6] },
    ...over,
  };
}

describe("buildDotImpacts", () => {
  it("returns empty without events or a usable route", () => {
    expect(buildDotImpacts([], ROUTE, 0)).toEqual([]);
    expect(buildDotImpacts([makeEvent()], [], 0)).toEqual([]);
  });

  it("places an on-route work zone as a construction impact", () => {
    const out = buildDotImpacts([makeEvent()], ROUTE, 0);
    expect(out).toHaveLength(1);
    const i = out[0]!;
    expect(i.source).toBe("dot511");
    expect(i.category).toBe("construction");
    expect(i.severity).toBe("caution");
    expect(i.crossesRoute).toBe(true);
    expect(i.driverAction).toBe("slow");
    expect(i.detail).toContain("Iowa DOT");
  });

  it("drops events outside the corridor half-width", () => {
    const far = makeEvent({
      point: [-93.65, 41.63],
      geometry: { type: "Point", coordinates: [-93.65, 41.63] },
    });
    expect(buildDotImpacts([far], ROUTE, 0)).toEqual([]);
  });

  it("all-lanes-closed maps to avoid + reroute", () => {
    const closed = makeEvent({ kind: "closure", vehicleImpact: "all-lanes-closed" });
    const out = buildDotImpacts([closed], ROUTE, 0);
    expect(out[0]!.severity).toBe("avoid");
    expect(out[0]!.driverAction).toBe("rerouteRecommended");
    expect(out[0]!.category).toBe("closure");
  });

  it("truck size/weight limits bump severity to serious", () => {
    const limited = makeEvent({ restrictionsText: "Weight limit 80,000 lb" });
    const out = buildDotImpacts([limited], ROUTE, 0);
    expect(out[0]!.severity).toBe("serious");
    expect(out[0]!.detail).toContain("Weight limit");
  });

  it("scheduled events are flagged in the headline", () => {
    const future = makeEvent({ status: "scheduled" });
    const out = buildDotImpacts([future], ROUTE, 0);
    expect(out[0]!.driverHeadline).toContain("scheduled");
  });

  it("shoulder-only closure stays caution when lane detail clears travel lanes", () => {
    const shoulder = makeEvent({
      lanesClosed: 1,
      travelLanesClosed: 0,
      laneSummary: "shoulder closed",
      vehicleImpact: "some-lanes-closed",
    });
    const out = buildDotImpacts([shoulder], ROUTE, 0);
    expect(out[0]!.severity).toBe("caution");
    expect(out[0]!.detail).toContain("shoulder closed");
  });

  it("closed travel lane bumps to serious and shows the lane summary", () => {
    const lane = makeEvent({
      lanesClosed: 1,
      travelLanesClosed: 1,
      laneSummary: "1 lane closed",
      vehicleImpact: "some-lanes-closed",
    });
    const out = buildDotImpacts([lane], ROUTE, 0);
    expect(out[0]!.severity).toBe("serious");
    expect(out[0]!.driverAction).toBe("rerouteAvailable");
    expect(out[0]!.detail).toContain("1 lane closed");
  });

  it("includes the work type label in detail when the feed publishes it", () => {
    const wt = makeEvent({ workType: "Surface work" });
    const out = buildDotImpacts([wt], ROUTE, 0);
    expect(out[0]!.detail).toContain("Surface work");
  });

  it("winter condition reports map to the winter category", () => {
    const icy = makeEvent({
      kind: "condition",
      vehicleImpact: "ice",
      workType: "Ice",
      publisher: "Illinois DOT",
    });
    const out = buildDotImpacts([icy], ROUTE, 0);
    expect(out[0]!.category).toBe("winter");
    expect(out[0]!.severity).toBe("serious");
    expect(out[0]!.driverHeadline).toContain("Winter condition");
  });

  it("partially covered winter condition stays caution", () => {
    const partial = makeEvent({
      kind: "condition",
      vehicleImpact: "partially-covered",
      workType: "Partially covered",
    });
    const out = buildDotImpacts([partial], ROUTE, 0);
    expect(out[0]!.severity).toBe("caution");
    expect(out[0]!.driverAction).toBe("slow");
    expect(out[0]!.roadEffect).toContain("Winter road condition");
  });
});

/** Event parked at a longitude on the test route (lat 41.6). */
function eventAt(lng: number, over: Partial<DotRoadEvent> = {}): DotRoadEvent {
  return makeEvent({
    point: [lng, 41.6],
    geometry: { type: "Point", coordinates: [lng, 41.6] },
    ...over,
  });
}

describe("DOT event clustering", () => {
  it("merges direction splits of the same work zone into one entry", () => {
    const eb = eventAt(-93.66, { direction: "eastbound" });
    const wb = eventAt(-93.655, { direction: "westbound" });
    const out = buildDotImpacts([eb, wb], ROUTE, 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.detail).toContain("eastbound / westbound");
  });

  it("keeps distant events on the same road separate", () => {
    const a = eventAt(-93.69);
    const b = eventAt(-93.61); /* ~6.7 km apart — beyond cluster gap */
    const out = buildDotImpacts([a, b], ROUTE, 0);
    expect(out).toHaveLength(2);
  });

  it("does not merge different roads at the same spot", () => {
    const a = eventAt(-93.65, { roadName: "I-80", title: "I-80" });
    const b = eventAt(-93.65, { roadName: "I-35", title: "I-35" });
    const out = buildDotImpacts([a, b], ROUTE, 0);
    expect(out).toHaveLength(2);
  });

  it("chains segmented zones on the same road into one span", () => {
    /* Three segments ~700 m apart — one long work zone reported in pieces. */
    const segs = [-93.68, -93.672, -93.664].map((lng) => eventAt(lng));
    const out = buildDotImpacts(segs, ROUTE, 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.endMeters).toBeGreaterThan(out[0]!.startMeters);
  });

  it("merged clusters keep the worst lane detail", () => {
    const shoulderOnly = eventAt(-93.66, {
      lanesClosed: 1,
      travelLanesClosed: 0,
      laneSummary: "shoulder closed",
      vehicleImpact: "some-lanes-closed",
    });
    const laneClosed = eventAt(-93.655, {
      lanesClosed: 2,
      travelLanesClosed: 1,
      laneSummary: "1 lane closed",
      vehicleImpact: "some-lanes-closed",
    });
    const out = buildDotImpacts([shoulderOnly, laneClosed], ROUTE, 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("serious");
    expect(out[0]!.detail).toContain("1 lane closed");
  });
});

describe("reconcileDotMapboxImpacts", () => {
  function dotImpact(lng: number): RouteImpact {
    return buildDotImpacts([eventAt(lng)], ROUTE, 0)[0]!;
  }
  function mapboxIncidentAt(lng: number, over: Partial<RouteImpact> = {}): RouteImpact {
    const base = dotImpact(lng);
    return {
      ...base,
      id: "mapbox-incident-0-construction",
      source: "mapboxIncident",
      category: "construction",
      detail: "Construction zone with lane reductions",
      driverHeadline: "Construction zone",
      ...over,
    };
  }

  it("drops a Mapbox incident duplicating a DOT event and folds its text", () => {
    const dot = dotImpact(-93.65);
    const mb = mapboxIncidentAt(-93.648);
    const out = reconcileDotMapboxImpacts([dot, mb]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("dot511");
    expect(out[0]!.detail).toContain("Also reported: Construction zone");
  });

  it("keeps Mapbox incidents far from any DOT event", () => {
    const dot = dotImpact(-93.69);
    const mb = mapboxIncidentAt(-93.61);
    const out = reconcileDotMapboxImpacts([dot, mb]);
    expect(out).toHaveLength(2);
  });

  it("does not merge a crash into a work zone", () => {
    const dot = dotImpact(-93.65);
    const crash = mapboxIncidentAt(-93.65, { category: "incident", id: "mb-crash" });
    const out = reconcileDotMapboxImpacts([dot, crash]);
    expect(out).toHaveLength(2);
  });
});
