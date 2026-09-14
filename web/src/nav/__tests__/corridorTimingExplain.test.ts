import { describe, expect, it } from "vitest";
import {
  buildCorridorTimingExplainLines,
  compactTimingEta,
  mayPassTimingLine,
  outlookPrecipScore,
} from "../corridorTimingExplain";
import type { RouteImpact } from "../routeImpacts";

function impact(over: Partial<RouteImpact>): RouteImpact {
  return {
    id: "i1",
    category: "weather",
    severity: "caution",
    confidence: "medium",
    source: "nws",
    lngLat: [-90, 35],
    alongMeters: 50_000,
    startMeters: 40_000,
    endMeters: 60_000,
    distanceAheadMeters: 50_000,
    etaAheadMinutes: 120,
    driverHeadline: "Tornado Watch",
    driverAction: "watch",
    roadEffect: "Watch the sky",
    detail: "detail",
    numericSeverity: 60,
    ...over,
  };
}

describe("compactTimingEta", () => {
  it("formats compact durations", () => {
    expect(compactTimingEta(0.4)).toBe("now");
    expect(compactTimingEta(45)).toBe("~45 min");
    expect(compactTimingEta(120)).toBe("~2h");
    expect(compactTimingEta(80)).toBe("~1h 20m");
  });
});

describe("outlookPrecipScore", () => {
  it("scores thunder high", () => {
    expect(
      outlookPrecipScore({
        fraction: 0.5,
        shortLabel: "Mid",
        conditions: "Thunderstorms",
        precipHint: 0.2,
        precipPct: 20,
        etaLabel: "1h 20m",
      })
    ).toBe(1);
  });
});

describe("buildCorridorTimingExplainLines", () => {
  it("explains storm on map with clear ETA forecast", () => {
    const lines = buildCorridorTimingExplainLines({
      hasActiveRoute: true,
      userAlongT: 0,
      remainingEtaMinutes: 120,
      radarSamples: [
        { t: 0.2, intensity: 0.7 },
        { t: 0.5, intensity: 0.8 },
      ],
      outlookSteps: [
        {
          fraction: 0.5,
          shortLabel: "Mid",
          conditions: "Clear",
          precipHint: 0.05,
          precipPct: 5,
          etaLabel: "1h",
        },
        {
          fraction: 1,
          shortLabel: "Dest",
          conditions: "Fair",
          precipHint: 0.1,
          precipPct: 10,
          etaLabel: "2h",
        },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.badge).toBe("Timing");
    expect(lines[0]!.text).toMatch(/Storm on the map now/);
    expect(lines[0]!.text).toMatch(/forecast clear/);
    expect(lines[0]!.text).toMatch(/~2h/);
  });

  it("explains clear map with thunderstorms ahead at ETA", () => {
    const lines = buildCorridorTimingExplainLines({
      hasActiveRoute: true,
      userAlongT: 0,
      remainingEtaMinutes: 90,
      radarSamples: [
        { t: 0.2, intensity: 0.05 },
        { t: 0.6, intensity: 0.08 },
      ],
      outlookSteps: [
        {
          fraction: 0.5,
          shortLabel: "Mid",
          conditions: "Thunderstorms",
          precipHint: 0.7,
          precipPct: 70,
          etaLabel: "1h 20m",
        },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/Clear on the map now/);
    expect(lines[0]!.text).toMatch(/thunderstorms likely near Mid/);
    expect(lines[0]!.tone).toBe("warn");
  });

  it("surfaces may_pass NWS timing when radar/forecast do not already explain", () => {
    const lines = buildCorridorTimingExplainLines({
      hasActiveRoute: true,
      userAlongT: 0,
      remainingEtaMinutes: 120,
      radarSamples: [],
      outlookSteps: [],
      routeImpacts: [
        impact({
          arrivalVerdict: "may_pass",
          arrivalVerdictLine: "Likely over before you reach it",
          etaAheadMinutes: 120,
        }),
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/Tornado Watch on the map/);
    expect(lines[0]!.text).toMatch(/likely over before you reach it/);
  });

  it("skips may_pass when clear-by-ETA already said", () => {
    const lines = buildCorridorTimingExplainLines({
      hasActiveRoute: true,
      userAlongT: 0,
      remainingEtaMinutes: 120,
      radarSamples: [{ t: 0.4, intensity: 0.75 }],
      outlookSteps: [
        {
          fraction: 0.5,
          shortLabel: "Mid",
          conditions: "Clear",
          precipHint: 0,
          precipPct: 0,
          etaLabel: null,
        },
      ],
      routeImpacts: [
        impact({
          arrivalVerdict: "may_pass",
          arrivalVerdictLine: "Likely over before you reach it",
        }),
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/forecast clear/);
  });
});

describe("mayPassTimingLine", () => {
  it("ignores traffic may_pass", () => {
    expect(
      mayPassTimingLine(
        impact({
          source: "mapboxTraffic",
          category: "traffic",
          arrivalVerdict: "may_pass",
          arrivalVerdictLine: "Jam may clear before you arrive",
        })
      )
    ).toBeNull();
  });
});
