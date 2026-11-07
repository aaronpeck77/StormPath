import { describe, expect, it } from "vitest";
import { buildTripBriefing } from "../tripBriefing";
import type { NavRoute } from "../../nav/types";
import type { ScoredRoute } from "../../scoring/scoreRoutes";
import type { RouteImpact } from "../../nav/routeImpacts";
import type { DepartureAnalysis } from "../departureScan";

const NOW = new Date("2026-01-15T12:00:00").getTime();

function route(id: string, role: NavRoute["role"] = "fastest"): NavRoute {
  return {
    id,
    role,
    label: `Route ${id}`,
    geometry: [
      [-100, 40],
      [-99, 40.5],
      [-98, 41],
    ],
    baseEtaMinutes: 120,
  };
}

function scored(r: NavRoute, eta = 120): ScoredRoute {
  return {
    route: r,
    effectiveEtaMinutes: eta,
    baselineEtaMinutes: 120,
    hasLiveTrafficEstimate: true,
    trafficDelayMinutes: 0,
    stressScore: 0,
    fuseSummary: "",
    notable: false,
  };
}

function impact(partial: Partial<RouteImpact>): RouteImpact {
  return {
    id: "i1",
    category: "weather",
    severity: "serious",
    confidence: "high",
    source: "nws",
    lngLat: [-99, 40.5],
    alongMeters: 10_000,
    startMeters: 10_000,
    endMeters: 12_000,
    distanceAheadMeters: 10_000,
    etaAheadMinutes: 42,
    driverHeadline: "Severe thunderstorm warning ahead",
    driverAction: "prepare",
    roadEffect: "Heavy rain may slow traffic",
    detail: "detail",
    numericSeverity: 75,
    ...partial,
  };
}

const departureReady: DepartureAnalysis = {
  status: "ready",
  candidates: [],
  recommendation: {
    kind: "wait",
    headline: "Consider leaving around 3:00 PM",
    detail: "Heaviest corridor weather ~2–5 PM.",
    shiftMin: 180,
    arriveOffsetMin: 420,
  },
  stormWindow: { startMin: 120, endMin: 300 },
  coverageMin: 720,
};

function baseInput(overrides: Record<string, unknown> = {}) {
  const r = route("a");
  return {
    route: r,
    routeLetter: "A",
    routeLabel: "Main",
    isSuggested: true,
    destinationLabel: "Denver",
    originLabel: "Your location",
    scored: scored(r),
    allScored: [scored(r)],
    slice: undefined,
    impacts: [],
    forecast: null,
    forecastProvider: null,
    departureStatus: "ready" as const,
    departureAnalysis: departureReady,
    letterFor: (id: string) => (id === "a" ? "A" : "B"),
    suggestedRouteId: "a",
    useMiles: true,
    nowMs: NOW,
    ...overrides,
  };
}

describe("buildTripBriefing", () => {
  it("maps the departure recommendation into the leave card", () => {
    const b = buildTripBriefing(baseInput());
    expect(b.leaveCard.kind).toBe("wait");
    expect(b.leaveCard.headline).toContain("3:00");
    expect(b.leaveCard.arriveLabel).toContain("arrive ~");
    expect(b.leaveCard.coverageNote).toBeNull();
  });

  it("shows loading and unavailable leave-card states", () => {
    const loading = buildTripBriefing(baseInput({ departureStatus: "loading", departureAnalysis: null }));
    expect(loading.leaveCard.headline).toContain("Checking");
    const gone = buildTripBriefing(baseInput({ departureStatus: "unavailable", departureAnalysis: null }));
    expect(gone.leaveCard.headline).toContain("unavailable");
  });

  it("adds a partial-coverage honesty note", () => {
    const partial: DepartureAnalysis = { ...departureReady, status: "partial", coverageMin: 540 };
    const b = buildTripBriefing(baseInput({ departureAnalysis: partial }));
    expect(b.leaveCard.coverageNote).toContain("~9 h");
  });

  it("lists route impacts with timing, capped at five", () => {
    const impacts = Array.from({ length: 7 }, (_, i) =>
      impact({ id: `i${i}`, etaAheadMinutes: 10 + i * 10 })
    );
    const b = buildTripBriefing(baseInput({ impacts }));
    expect(b.hazards).toHaveLength(5);
    expect(b.hazards[0]!.when).toContain("into drive");
    expect(b.hazards[0]!.tone).toBe("serious");
  });

  it("falls back to route notices when there are no impacts", () => {
    const r = route("a");
    r.routeNotices = ["Road closed ahead", "Construction zone"];
    const b = buildTripBriefing(
      baseInput({ route: r, scored: scored(r), allScored: [scored(r)] })
    );
    expect(b.hazards.length).toBeGreaterThan(0);
    expect(b.hazards[0]!.headline).toContain("Road closed");
  });

  it("notes when the focused route is not StormPath's pick", () => {
    const a = route("a");
    const bRoute = route("b", "balanced");
    const b = buildTripBriefing(
      baseInput({
        route: a,
        isSuggested: false,
        allScored: [scored(a), scored(bRoute, 140)],
        suggestedRouteId: "b",
        letterFor: (id: string) => (id === "b" ? "B" : "A"),
      })
    );
    expect(b.alternateNote).toContain("Route B");
  });

  it("builds an honest traffic line for static ETAs", () => {
    const b = buildTripBriefing(
      baseInput({
        slice: {
          routeId: "a",
          role: "fastest",
          trafficDelayMinutes: 0,
          mapboxDurationMinutes: null,
          hasLiveTrafficEstimate: false,
          radarIntensity: 0,
          forecastHeadline: "",
          hazards: [],
        },
      })
    );
    expect(b.trafficLine).toContain("static");
  });
});
