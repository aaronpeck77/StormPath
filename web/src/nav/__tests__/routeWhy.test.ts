import { describe, expect, it } from "vitest";
import type { NavRoute } from "../types";
import type { ScoredRoute } from "../../scoring/scoreRoutes";
import { routeWhySummary } from "../routeWhy";

function fakeRoute(partial: Partial<NavRoute>): NavRoute {
  return {
    id: "r",
    role: "balanced",
    label: "Route",
    geometry: [
      [-86.5, 39.1],
      [-86.4, 39.2],
    ],
    baseEtaMinutes: 30,
    ...partial,
  };
}

function fakeScored(partial: Partial<ScoredRoute>): ScoredRoute {
  const route = partial.route ?? fakeRoute({});
  return {
    route,
    effectiveEtaMinutes: partial.effectiveEtaMinutes ?? route.baseEtaMinutes,
    baselineEtaMinutes: partial.baselineEtaMinutes ?? route.baseEtaMinutes,
    hasLiveTrafficEstimate: partial.hasLiveTrafficEstimate ?? false,
    trafficDelayMinutes: partial.trafficDelayMinutes ?? 0,
    stressScore: partial.stressScore ?? 0,
    fuseSummary: partial.fuseSummary ?? "",
    notable: partial.notable ?? false,
    radarIntensity: partial.radarIntensity,
    roadHazardCount: partial.roadHazardCount,
  };
}

function pair(over: { fastest?: Partial<ScoredRoute>; alt?: Partial<ScoredRoute> } = {}) {
  const fastestRoute = fakeRoute({ id: "r-a", role: "fastest", label: "Main", baseEtaMinutes: 60 });
  const altRoute = fakeRoute({ id: "r-b", role: "balanced", label: "Alternate", baseEtaMinutes: 66 });
  const fastest = fakeScored({ route: fastestRoute, effectiveEtaMinutes: 60, ...over.fastest });
  const alt = fakeScored({ route: altRoute, effectiveEtaMinutes: 66, ...over.alt });
  return { fastest, alt, all: [fastest, alt] };
}

describe("routeWhySummary", () => {
  it("names the fastest leg 'Fastest'", () => {
    const { fastest, all } = pair();
    expect(routeWhySummary(fastest, all, fastest.route)).toBe("Fastest");
  });

  it("flags heavy live traffic on the fastest leg honestly", () => {
    const { fastest, all } = pair({
      fastest: { hasLiveTrafficEstimate: true, trafficDelayMinutes: 22 },
    });
    expect(routeWhySummary(fastest, all, fastest.route)).toContain("Fastest");
    expect(routeWhySummary(fastest, all, fastest.route)).toContain("traffic");
  });

  it("does not flag traffic on the fastest leg without live estimates", () => {
    const { fastest, all } = pair({ fastest: { trafficDelayMinutes: 30 } });
    expect(routeWhySummary(fastest, all, fastest.route)).toBe("Fastest");
  });

  it("prefers incident avoidance over everything else", () => {
    const { fastest, alt } = pair();
    const withIncident = fakeRoute({
      ...fastest.route,
      mapboxIncidents: [{ type: "closure", description: "Crash", impact: "major" }],
    });
    fastest.route = withIncident;
    const rescored = fakeScored({ ...fastest, route: withIncident });
    expect(routeWhySummary(alt, [rescored, alt], alt.route)).toBe("Avoids a road incident");
  });

  it("reports clearer skies when corridor precip is meaningfully lower", () => {
    const { alt, all } = pair({
      fastest: { radarIntensity: 0.6 },
      alt: { radarIntensity: 0.2 },
    });
    expect(routeWhySummary(alt, all, alt.route)).toBe("Clearer skies");
  });

  it("ignores precip differences below the noise floor", () => {
    const { alt, all } = pair({
      fastest: { radarIntensity: 0.3 },
      alt: { radarIntensity: 0.22 },
    });
    expect(routeWhySummary(alt, all, alt.route)).toBe("Backroads");
  });

  it("says 'Lighter traffic' when live delay is meaningfully saved", () => {
    const { alt, all } = pair({
      fastest: { hasLiveTrafficEstimate: true, trafficDelayMinutes: 15 },
      alt: { hasLiveTrafficEstimate: true, trafficDelayMinutes: 4 },
    });
    expect(routeWhySummary(alt, all, alt.route)).toBe("Lighter traffic");
  });

  it("does not claim lighter traffic without live estimates on both legs", () => {
    const { alt, all } = pair({
      fastest: { trafficDelayMinutes: 15 },
      alt: { hasLiveTrafficEstimate: true, trafficDelayMinutes: 0 },
    });
    expect(routeWhySummary(alt, all, alt.route)).toBe("Backroads");
  });

  it("says 'Stays off interstate' for hazardSmart routes with no fused edge", () => {
    const altRoute = fakeRoute({ id: "r-b", role: "hazardSmart", label: "No interstate" });
    const fastest = fakeScored({
      route: fakeRoute({ id: "r-a", role: "fastest", label: "Main" }),
      effectiveEtaMinutes: 60,
    });
    const alt = fakeScored({ route: altRoute, effectiveEtaMinutes: 70 });
    expect(routeWhySummary(alt, [fastest, alt], altRoute)).toBe("Stays off interstate");
  });

  it("falls back to the consideration blurb when the route has no score slice", () => {
    const { all } = pair();
    const unlabeled = fakeRoute({ id: "r-c", role: "balanced", label: "Alternate" });
    expect(routeWhySummary(undefined, all, unlabeled)).toBe("Alternate");
  });
});
