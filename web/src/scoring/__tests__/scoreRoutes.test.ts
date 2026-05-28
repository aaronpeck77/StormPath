import { describe, expect, it } from "vitest";
import type { NavRoute, TripPlan } from "../../nav/types";
import type {
  FusedSituationSnapshot,
  RouteSituationSlice,
} from "../../situation/types";
import { pickSuggestedActive, scoreTrip, type ScoredRoute } from "../scoreRoutes";

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

function fakeSlice(partial: Partial<RouteSituationSlice>): RouteSituationSlice {
  return {
    routeId: partial.routeId ?? "r",
    role: partial.role ?? "balanced",
    trafficDelayMinutes: partial.trafficDelayMinutes ?? 0,
    mapboxDurationMinutes: partial.mapboxDurationMinutes ?? null,
    hasLiveTrafficEstimate: partial.hasLiveTrafficEstimate ?? false,
    radarIntensity: partial.radarIntensity ?? 0,
    forecastHeadline: partial.forecastHeadline ?? "",
    hazards: partial.hazards ?? [],
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
  };
}

describe("pickSuggestedActive", () => {
  it("returns an empty string for an empty input", () => {
    expect(pickSuggestedActive([])).toBe("");
  });

  it("picks the lowest stress regardless of ETA", () => {
    const list = [
      fakeScored({ route: fakeRoute({ id: "a" }), stressScore: 0.4, effectiveEtaMinutes: 25 }),
      fakeScored({ route: fakeRoute({ id: "b" }), stressScore: 0.1, effectiveEtaMinutes: 35 }),
      fakeScored({ route: fakeRoute({ id: "c" }), stressScore: 0.3, effectiveEtaMinutes: 30 }),
    ];
    expect(pickSuggestedActive(list)).toBe("b");
  });

  it("breaks stress ties by ETA ascending", () => {
    const list = [
      fakeScored({ route: fakeRoute({ id: "slow" }), stressScore: 0.2, effectiveEtaMinutes: 40 }),
      fakeScored({ route: fakeRoute({ id: "fast" }), stressScore: 0.2, effectiveEtaMinutes: 28 }),
    ];
    expect(pickSuggestedActive(list)).toBe("fast");
  });

  it("does not mutate the input array order", () => {
    const list = [
      fakeScored({ route: fakeRoute({ id: "a" }), stressScore: 0.5 }),
      fakeScored({ route: fakeRoute({ id: "b" }), stressScore: 0.1 }),
    ];
    const before = list.map((s) => s.route.id);
    pickSuggestedActive(list);
    expect(list.map((s) => s.route.id)).toEqual(before);
  });
});

describe("scoreTrip", () => {
  const plan: TripPlan = {
    originLabel: "A",
    destinationLabel: "B",
    routes: [
      fakeRoute({ id: "r1", baseEtaMinutes: 30 }),
      fakeRoute({ id: "r2", baseEtaMinutes: 32 }),
    ],
  };

  it("returns one ScoredRoute per route in the plan, in plan order", () => {
    const snap: FusedSituationSnapshot = {
      updatedAt: 0,
      routes: [],
      statusSummary: "",
    };
    const out = scoreTrip(plan, snap, "balanced");
    expect(out).toHaveLength(2);
    expect(out[0]!.route.id).toBe("r1");
    expect(out[1]!.route.id).toBe("r2");
  });

  it("uses the static baseline ETA when no live traffic estimate is available", () => {
    const snap: FusedSituationSnapshot = {
      updatedAt: 0,
      routes: [
        fakeSlice({ routeId: "r1", trafficDelayMinutes: 4 }),
        fakeSlice({ routeId: "r2" }),
      ],
      statusSummary: "",
    };
    const out = scoreTrip(plan, snap, "balanced");
    /* No `hasLiveTrafficEstimate` flag → effective = base + delay. */
    expect(out[0]!.hasLiveTrafficEstimate).toBe(false);
    expect(out[0]!.effectiveEtaMinutes).toBe(34);
    expect(out[1]!.effectiveEtaMinutes).toBe(32);
  });

  it("uses Mapbox live traffic when both flag and duration are present", () => {
    const snap: FusedSituationSnapshot = {
      updatedAt: 0,
      routes: [
        fakeSlice({
          routeId: "r1",
          hasLiveTrafficEstimate: true,
          mapboxDurationMinutes: 41,
          trafficDelayMinutes: 11,
        }),
      ],
      statusSummary: "",
    };
    const out = scoreTrip({ ...plan, routes: [plan.routes[0]!] }, snap, "balanced");
    expect(out[0]!.hasLiveTrafficEstimate).toBe(true);
    expect(out[0]!.effectiveEtaMinutes).toBe(41);
    expect(out[0]!.trafficDelayMinutes).toBe(11);
  });

  it("flags `notable` for protective preset whenever weather/traffic stress is non-trivial", () => {
    const snap: FusedSituationSnapshot = {
      updatedAt: 0,
      routes: [
        fakeSlice({ routeId: "r1", radarIntensity: 0.4 }),
        fakeSlice({ routeId: "r2" }),
      ],
      statusSummary: "",
    };
    const out = scoreTrip(plan, snap, "protective");
    expect(out[0]!.notable).toBe(true);
    expect(out[1]!.notable).toBe(false);
  });

  it("only flags `notable` for quiet preset on big delays or closures", () => {
    const snap: FusedSituationSnapshot = {
      updatedAt: 0,
      routes: [
        fakeSlice({ routeId: "r1", radarIntensity: 0.5 }),
        fakeSlice({
          routeId: "r2",
          hazards: [{ kind: "closure", summary: "Bridge closed" }],
        }),
      ],
      statusSummary: "",
    };
    const out = scoreTrip(plan, snap, "quiet");
    /* Quiet preset ignores rain alone — only delay or closure trips it. */
    expect(out[0]!.notable).toBe(false);
    expect(out[1]!.notable).toBe(true);
  });

  it("emits a fallback fuseSummary when no slice is found", () => {
    const snap: FusedSituationSnapshot = {
      updatedAt: 0,
      routes: [],
      statusSummary: "",
    };
    const out = scoreTrip(plan, snap, "balanced");
    for (const s of out) {
      expect(s.fuseSummary).toBe("No fused data");
    }
  });
});
