import { describe, expect, it } from "vitest";
import { buildDotImpacts } from "../dotImpacts";
import type { DotRoadEvent } from "../../services/dotRoadEvents";
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
    expect(buildDotImpacts([], ROUTE, 0, 10_000)).toEqual([]);
    expect(buildDotImpacts([makeEvent()], [], 0, 10_000)).toEqual([]);
  });

  it("places an on-route work zone as a construction impact", () => {
    const out = buildDotImpacts([makeEvent()], ROUTE, 0, 10_000);
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
    expect(buildDotImpacts([far], ROUTE, 0, 10_000)).toEqual([]);
  });

  it("all-lanes-closed maps to avoid + reroute", () => {
    const closed = makeEvent({ kind: "closure", vehicleImpact: "all-lanes-closed" });
    const out = buildDotImpacts([closed], ROUTE, 0, 10_000);
    expect(out[0]!.severity).toBe("avoid");
    expect(out[0]!.driverAction).toBe("rerouteRecommended");
    expect(out[0]!.category).toBe("closure");
  });

  it("truck size/weight limits bump severity to serious", () => {
    const limited = makeEvent({ restrictionsText: "Weight limit 80,000 lb" });
    const out = buildDotImpacts([limited], ROUTE, 0, 10_000);
    expect(out[0]!.severity).toBe("serious");
    expect(out[0]!.detail).toContain("Weight limit");
  });

  it("scheduled events are flagged in the headline", () => {
    const future = makeEvent({ status: "scheduled" });
    const out = buildDotImpacts([future], ROUTE, 0, 10_000);
    expect(out[0]!.driverHeadline).toContain("scheduled");
  });
});
