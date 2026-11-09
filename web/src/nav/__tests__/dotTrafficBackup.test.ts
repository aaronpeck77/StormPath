import { describe, expect, it } from "vitest";
import { applyDotTrafficBackup, bandTrafficBackup } from "../dotTrafficBackup";
import type { MapboxTrafficLeg } from "../../services/mapboxDirectionsTraffic";
import type { RouteImpact } from "../routeImpacts";

const TOTAL_M = 100_000;

function legWith(congestion: (number | null)[], over: Partial<MapboxTrafficLeg> = {}): MapboxTrafficLeg {
  return {
    mapboxDurationMinutes: 60,
    typicalDurationMinutes: 50,
    delayVsTypicalMinutes: 10,
    congestionSummary: "heavy",
    hasClosure: false,
    constructionCount: 0,
    constructionSummary: null,
    nearStopFraction: null,
    firstHeavyCongestionFraction: null,
    congestionNumeric: congestion,
    ...over,
  };
}

function dotImpact(over: Partial<RouteImpact> = {}): RouteImpact {
  return {
    id: "dot:test",
    category: "construction",
    severity: "caution",
    confidence: "high",
    source: "dot511",
    lngLat: [0, 0],
    alongMeters: 60_000,
    startMeters: 55_000,
    endMeters: 65_000,
    distanceAheadMeters: 5_000,
    etaAheadMinutes: null,
    driverHeadline: "Work zone",
    driverAction: "slow",
    roadEffect: "Lane closures or work zone ahead — expect delays",
    detail: "Iowa DOT: Road construction work is in progress.",
    numericSeverity: 35,
    ...over,
  };
}

describe("bandTrafficBackup", () => {
  it("returns null without congestion samples", () => {
    expect(bandTrafficBackup(null, 0, 1000, 0, TOTAL_M)).toBeNull();
    expect(bandTrafficBackup(legWith([]), 0, 1000, 0, TOTAL_M)).toBeNull();
  });

  it("maps a mid-trip band onto the remaining-route sample span", () => {
    /* Puck at 50 km of 100 km → fetch covers [50k,100k]; 20 segments ≈ 2.5 km each. */
    const segs = Array.from({ length: 20 }, () => 10);
    segs[3] = 95; /* band [55k,65k] rebased to remaining span → fraction .1–.3 → segs 2–5 */
    const leg = legWith(segs);
    const b = bandTrafficBackup(leg, 55_000, 65_000, 50_000, TOTAL_M);
    expect(b).not.toBeNull();
    expect(b!.worst).toBe(95);
    expect(b!.level).toBe("severe");
    /* Only the >=60 segment counts toward backed-up meters (≈2.5 km). */
    expect(b!.backedUpMeters).toBeCloseTo(2_500, -2);
  });

  it("uses the full-route span when the trip barely started", () => {
    const segs = Array.from({ length: 20 }, () => 10);
    segs[11] = 80; /* band [55k,65k] of 100k → fraction .55–.65 → segs ~11–13 */
    const b = bandTrafficBackup(legWith(segs), 55_000, 65_000, 0, TOTAL_M);
    expect(b).not.toBeNull();
    expect(b!.level).toBe("heavy");
  });

  it("returns null for a band outside the fetched span or free-flowing", () => {
    const segs = Array.from({ length: 20 }, () => 10);
    expect(bandTrafficBackup(legWith(segs), 0, 1_000, 50_000, TOTAL_M)).toBeNull();
    expect(bandTrafficBackup(legWith(segs), 55_000, 65_000, 50_000, TOTAL_M)).toBeNull();
  });
});

describe("applyDotTrafficBackup", () => {
  it("promotes a severe backup to serious + rerouteAvailable with detail text", () => {
    const segs = Array.from({ length: 20 }, () => 10);
    segs[3] = 95;
    const impacts = [dotImpact()];
    applyDotTrafficBackup(impacts, legWith(segs), 50_000, TOTAL_M);
    const i = impacts[0]!;
    expect(i.severity).toBe("serious");
    expect(i.driverAction).toBe("rerouteAvailable");
    expect(i.detail).toContain("Live traffic shows stop-and-go");
    expect(i.roadEffect).toContain("Backed up");
  });

  it("heavy backup adds detail without changing severity or action", () => {
    const segs = Array.from({ length: 20 }, () => 10);
    segs[3] = 75;
    const impacts = [dotImpact()];
    applyDotTrafficBackup(impacts, legWith(segs), 50_000, TOTAL_M);
    const i = impacts[0]!;
    expect(i.severity).toBe("caution");
    expect(i.driverAction).toBe("slow");
    expect(i.detail).toContain("heavy congestion");
  });

  it("ignores non-DOT impacts and missing legs", () => {
    const segs = Array.from({ length: 20 }, () => 95);
    const other = dotImpact({ id: "mapbox-incident-0", source: "mapboxIncident" });
    const impacts = [other];
    applyDotTrafficBackup(impacts, legWith(segs), 50_000, TOTAL_M);
    expect(impacts[0]!.severity).toBe("caution");
    expect(impacts[0]!.detail).not.toContain("Live traffic");

    const dots = [dotImpact()];
    applyDotTrafficBackup(dots, null, 50_000, TOTAL_M);
    expect(dots[0]!.severity).toBe("caution");
  });
});
