import { describe, expect, it } from "vitest";
import {
  buildRouteImpacts,
  compareRouteImpactPriority,
  impactSeverityToNumeric,
  pickRerouteImpactAhead,
  radarMosaicToProgressStripBands,
  routeImpactToRouteAlert,
  type RouteImpact,
  type RouteImpactAction,
  type RouteImpactCategory,
  type RouteImpactConfidence,
  type RouteImpactSeverity,
} from "../routeImpacts";
import type { MapboxTrafficLeg } from "../../services/mapboxDirectionsTraffic";
import type { RouteSituationSlice } from "../../situation/types";
import type { LngLat } from "../types";

function fakeImpact(overrides: Partial<RouteImpact> = {}): RouteImpact {
  const severity: RouteImpactSeverity = overrides.severity ?? "caution";
  /* Build the base object first, then spread overrides last so explicit `null`
   * passes through (e.g. `distanceAheadMeters: null` to test missing distance). */
  const base: RouteImpact = {
    id: "i-test",
    category: "weather" as RouteImpactCategory,
    severity,
    confidence: "high" as RouteImpactConfidence,
    source: "fused",
    lngLat: [-86.5, 39.1],
    alongMeters: 5000,
    startMeters: 5000,
    endMeters: 5000,
    distanceAheadMeters: 5000,
    etaAheadMinutes: 8,
    driverHeadline: "Test impact",
    driverAction: "watch" as RouteImpactAction,
    roadEffect: "Be careful.",
    detail: "Detail copy.",
    numericSeverity: impactSeverityToNumeric(severity),
  };
  return { ...base, ...overrides };
}

describe("impactSeverityToNumeric", () => {
  it("maps severity tiers to monotonically increasing numbers", () => {
    const info = impactSeverityToNumeric("info");
    const caution = impactSeverityToNumeric("caution");
    const serious = impactSeverityToNumeric("serious");
    const avoid = impactSeverityToNumeric("avoid");
    expect(info).toBeLessThan(caution);
    expect(caution).toBeLessThan(serious);
    expect(serious).toBeLessThan(avoid);
    expect(avoid).toBe(90);
  });
});

describe("compareRouteImpactPriority", () => {
  it("ranks higher severity ahead of lower severity", () => {
    const a = fakeImpact({ severity: "avoid" });
    const b = fakeImpact({ severity: "caution" });
    /* compareFn < 0 means `a` comes first when sorted ascending. */
    expect(compareRouteImpactPriority(a, b)).toBeLessThan(0);
    expect(compareRouteImpactPriority(b, a)).toBeGreaterThan(0);
  });

  it("breaks severity ties using the driver action rank", () => {
    const reroute = fakeImpact({ severity: "serious", driverAction: "rerouteRecommended" });
    const slow = fakeImpact({ severity: "serious", driverAction: "slow" });
    expect(compareRouteImpactPriority(reroute, slow)).toBeLessThan(0);
  });

  it("breaks severity+action ties with numericSeverity", () => {
    const a = fakeImpact({ severity: "caution", driverAction: "slow", numericSeverity: 70 });
    const b = fakeImpact({ severity: "caution", driverAction: "slow", numericSeverity: 55 });
    /* Higher numericSeverity ranks first. */
    expect(compareRouteImpactPriority(a, b)).toBeLessThan(0);
  });

  it("sorts a mixed list with severity > action > numeric precedence", () => {
    const items: RouteImpact[] = [
      fakeImpact({ id: "info", severity: "info", driverAction: "watch", numericSeverity: 30 }),
      fakeImpact({ id: "avoid", severity: "avoid", driverAction: "rerouteRecommended", numericSeverity: 90 }),
      fakeImpact({ id: "caution-low", severity: "caution", driverAction: "slow", numericSeverity: 40 }),
      fakeImpact({ id: "caution-high", severity: "caution", driverAction: "slow", numericSeverity: 70 }),
      fakeImpact({ id: "serious", severity: "serious", driverAction: "prepare", numericSeverity: 75 }),
    ];
    const ids = [...items].sort(compareRouteImpactPriority).map((i) => i.id);
    expect(ids).toEqual(["avoid", "serious", "caution-high", "caution-low", "info"]);
  });
});

describe("pickRerouteImpactAhead", () => {
  it("returns null when no impacts are eligible", () => {
    const items: RouteImpact[] = [
      fakeImpact({ driverAction: "watch", distanceAheadMeters: 4000 }),
      fakeImpact({ driverAction: "slow", distanceAheadMeters: 2000 }),
    ];
    expect(pickRerouteImpactAhead(items, 10_000)).toBeNull();
  });

  it("ignores impacts behind the user (distanceAheadMeters <= 0)", () => {
    const items: RouteImpact[] = [
      fakeImpact({
        id: "behind",
        driverAction: "rerouteRecommended",
        severity: "avoid",
        distanceAheadMeters: -5,
      }),
    ];
    expect(pickRerouteImpactAhead(items, 10_000)).toBeNull();
  });

  it("ignores impacts farther than the window", () => {
    const item = fakeImpact({
      id: "far",
      driverAction: "rerouteRecommended",
      severity: "serious",
      distanceAheadMeters: 12_000,
    });
    expect(pickRerouteImpactAhead([item], 8000)).toBeNull();
  });

  it("ignores low-confidence impacts even when otherwise eligible", () => {
    const item = fakeImpact({
      id: "shaky",
      driverAction: "rerouteRecommended",
      severity: "serious",
      confidence: "low",
      distanceAheadMeters: 2000,
    });
    expect(pickRerouteImpactAhead([item], 5000)).toBeNull();
  });

  it("picks the highest-priority eligible impact within the window", () => {
    const lower = fakeImpact({
      id: "soft-reroute",
      driverAction: "rerouteAvailable",
      severity: "caution",
      confidence: "medium",
      distanceAheadMeters: 1500,
    });
    const higher = fakeImpact({
      id: "hard-reroute",
      driverAction: "rerouteRecommended",
      severity: "avoid",
      confidence: "high",
      distanceAheadMeters: 4000,
    });
    expect(pickRerouteImpactAhead([lower, higher], 5000)?.id).toBe("hard-reroute");
    /* Order in the input shouldn't matter. */
    expect(pickRerouteImpactAhead([higher, lower], 5000)?.id).toBe("hard-reroute");
  });

  it("returns null distanceAhead impacts as ineligible (unknown distance)", () => {
    const item = fakeImpact({
      id: "no-distance",
      driverAction: "rerouteRecommended",
      severity: "serious",
      distanceAheadMeters: null,
    });
    expect(pickRerouteImpactAhead([item], 10_000)).toBeNull();
  });
});

describe("routeImpactToRouteAlert", () => {
  it("flags promptRerouteAhead for reroute-class actions only", () => {
    const slow = routeImpactToRouteAlert(fakeImpact({ driverAction: "slow" }));
    const recommended = routeImpactToRouteAlert(fakeImpact({ driverAction: "rerouteRecommended" }));
    const available = routeImpactToRouteAlert(fakeImpact({ driverAction: "rerouteAvailable" }));
    expect(slow.promptRerouteAhead).toBe(false);
    expect(recommended.promptRerouteAhead).toBe(true);
    expect(available.promptRerouteAhead).toBe(true);
  });

  it("maps category to the right corridorKind bucket", () => {
    const cases: { cat: RouteImpactCategory; kind: ReturnType<typeof routeImpactToRouteAlert>["corridorKind"] }[] = [
      { cat: "weather", kind: "weather" },
      { cat: "winter", kind: "weather" },
      { cat: "wind", kind: "weather" },
      { cat: "flooding", kind: "weather" },
      { cat: "visibility", kind: "weather" },
      { cat: "closure", kind: "hazard" },
      { cat: "incident", kind: "hazard" },
      { cat: "construction", kind: "hazard" },
      { cat: "traffic", kind: "traffic" },
      { cat: "other", kind: "notice" },
    ];
    for (const { cat, kind } of cases) {
      const alert = routeImpactToRouteAlert(fakeImpact({ category: cat }));
      expect(alert.corridorKind, `category=${cat}`).toBe(kind);
    }
  });

  it("uses the impact detail (or roadEffect fallback) and preserves alongMeters", () => {
    const withDetail = routeImpactToRouteAlert(
      fakeImpact({ detail: "Heavy rain across mile 18.", roadEffect: "Slow down.", alongMeters: 18_000 })
    );
    expect(withDetail.detail).toBe("Heavy rain across mile 18.");
    expect(withDetail.alongMeters).toBe(18_000);

    const withoutDetail = routeImpactToRouteAlert(
      fakeImpact({ detail: "", roadEffect: "Slow down — reduced visibility." })
    );
    expect(withoutDetail.detail).toBe("Slow down — reduced visibility.");
  });

  it("picks zoom by category (traffic 12.4, weather 11.5, other 12.6)", () => {
    expect(routeImpactToRouteAlert(fakeImpact({ category: "traffic" })).zoom).toBe(12.4);
    expect(routeImpactToRouteAlert(fakeImpact({ category: "weather" })).zoom).toBe(11.5);
    expect(routeImpactToRouteAlert(fakeImpact({ category: "incident" })).zoom).toBe(12.6);
  });
});

describe("buildRouteImpacts traffic gating", () => {
  const routeGeom: LngLat[] = [
    [-88.95, 40.12],
    [-89.4, 40.55],
    [-90.1, 41.02],
  ];

  const clearLeg: MapboxTrafficLeg = {
    mapboxDurationMinutes: 176,
    typicalDurationMinutes: 175.97,
    delayVsTypicalMinutes: 0.03,
    congestionSummary: "low",
    hasClosure: false,
    nearStopFraction: null,
    firstHeavyCongestionFraction: null,
  };

  const liveSlice = (delayMin: number): RouteSituationSlice => ({
    routeId: "r-a",
    role: "fastest",
    trafficDelayMinutes: delayMin,
    mapboxDurationMinutes: 176,
    hasLiveTrafficEstimate: true,
    radarIntensity: 0,
    forecastHeadline: "",
    hazards: [],
  });

  it("omits route-wide traffic when flow is clear with no meaningful delay", () => {
    const impacts = buildRouteImpacts({
      geometry: routeGeom,
      userLngLat: routeGeom[0]!,
      userAlongM: 0,
      planEtaMinutes: 176,
      slice: liveSlice(0.03),
      trafficForRoute: undefined,
      trafficLeg: clearLeg,
      nwsBands: [],
      nwsAlerts: [],
    });
    expect(impacts.some((i) => i.category === "traffic")).toBe(false);
  });

  it("omits route-wide delay without a localized backup or stoppage anchor", () => {
    const delayOnlyLeg: MapboxTrafficLeg = {
      ...clearLeg,
      delayVsTypicalMinutes: 7,
      congestionSummary: "moderate",
    };
    const impacts = buildRouteImpacts({
      geometry: routeGeom,
      userLngLat: routeGeom[0]!,
      userAlongM: 0,
      planEtaMinutes: 176,
      slice: liveSlice(7),
      trafficForRoute: undefined,
      trafficLeg: delayOnlyLeg,
      nwsBands: [],
      nwsAlerts: [],
    });
    expect(impacts.some((i) => i.category === "traffic")).toBe(false);
  });

  it("keeps localized slowdowns on the timeline", () => {
    const slowLeg: MapboxTrafficLeg = {
      ...clearLeg,
      delayVsTypicalMinutes: 6,
      congestionSummary: "heavy",
      firstHeavyCongestionFraction: 0.42,
    };
    const impacts = buildRouteImpacts({
      geometry: routeGeom,
      userLngLat: routeGeom[0]!,
      userAlongM: 0,
      planEtaMinutes: 176,
      slice: liveSlice(6),
      trafficForRoute: undefined,
      trafficLeg: slowLeg,
      nwsBands: [],
      nwsAlerts: [],
    });
    expect(impacts.some((i) => i.category === "traffic")).toBe(true);
  });

  it("does not add radar mosaic bands as route alert cards", () => {
    const impacts = buildRouteImpacts({
      geometry: routeGeom,
      userLngLat: routeGeom[0]!,
      userAlongM: 0,
      planEtaMinutes: 176,
      slice: undefined,
      trafficForRoute: undefined,
      trafficLeg: null,
      nwsBands: [],
      nwsAlerts: [],
      radarMosaicSamples: [
        { t: 0.2, intensity: 0.05 },
        { t: 0.35, intensity: 0.72 },
        { t: 0.5, intensity: 0.68 },
      ],
    });
    expect(impacts.some((i) => i.source === "radar")).toBe(false);
  });
});

describe("radarMosaicToProgressStripBands", () => {
  it("paints padded visible bands where mosaic echo crosses the route", () => {
    const bands = radarMosaicToProgressStripBands(100_000, [
      { t: 0.2, intensity: 0.05 },
      { t: 0.55, intensity: 0.85 },
      { t: 0.58, intensity: 0.9 },
    ]);
    expect(bands.length).toBeGreaterThanOrEqual(1);
    const heavy = bands.find((b) => b.severity === "serious" || b.severity === "caution");
    expect(heavy).toBeTruthy();
    expect(heavy!.endM - heavy!.startM).toBeGreaterThanOrEqual(2_500);
    expect(heavy!.lineHex).toMatch(/^#/);
  });
});
