import { describe, expect, it } from "vitest";
import { noticesMatch, splitRouteNoticeCallout } from "../progressCalloutCopy";
import { buildRouteChunkCalloutList } from "../routeProgressChunkList";
import type { RouteAlert } from "../routeAlerts";

describe("splitRouteNoticeCallout", () => {
  it("splits Mapbox-style notices into title and body", () => {
    const notice =
      "Construction — on I 72 West/US 36 — Road works on Interstate 72 between the New Salem/Pittsfield interchange and the Hull/Payson interchange";
    const { title, summary } = splitRouteNoticeCallout(notice, "restriction");
    expect(title).toBe("Construction");
    expect(summary).toContain("I 72 West/US 36");
    expect(summary).not.toBe(notice);
  });

  it("uses kind label when notice is a single line", () => {
    const { title, summary } = splitRouteNoticeCallout("Bridge closed ahead", "closure");
    expect(title).toBe("Closure ahead");
    expect(summary).toBe("Bridge closed ahead");
  });
});

describe("noticesMatch", () => {
  it("matches identical or contained notice text", () => {
    const full =
      "Lane restriction — on I 72 West/US 36 — Lane closed and temporary gross weight limit of 80 tons";
    expect(noticesMatch(full, full)).toBe(true);
    expect(noticesMatch("Closure ahead", full)).toBe(false);
    expect(noticesMatch(full, full.slice(0, 40))).toBe(true);
  });
});

describe("buildRouteChunkCalloutList serious rows", () => {
  const geometry = [
    [-89.65, 39.8],
    [-89.5, 39.9],
    [-89.35, 40.0],
  ] as [number, number][];
  const totalM = 200_000;

  it("does not duplicate title and summary for serious hazards", () => {
    const notice =
      "Construction — on I 72 West/US 36 — Road works on Interstate 72 between interchanges";
    const bundle = buildRouteChunkCalloutList({
      geometry,
      totalM,
      userAlongM: 0,
      planEtaMinutes: 300,
      slice: {
        routeId: "a",
        role: "fastest",
        trafficDelayMinutes: 0,
        mapboxDurationMinutes: 300,
        hasLiveTrafficEstimate: true,
        radarIntensity: 0,
        forecastHeadline: "",
        hazards: [{ kind: "restriction", summary: notice, alongMeters: 80_000 }],
      },
      weatherSamples: [],
      laidOutAlerts: [],
      stormBands: [],
      stripTint: "#3b82f6",
    });

    const hazardRow = bundle.segments.find((s) => s.key.startsWith("serious-hazard-"));
    expect(hazardRow).toBeDefined();
    expect(hazardRow!.title).toBe("Construction");
    expect(hazardRow!.summary).not.toBe(hazardRow!.title);
    expect(hazardRow!.summary).toContain("I 72 West/US 36");
  });

  it("skips serious hazard when the same notice is already a serious alert", () => {
    const notice = "Road closure on this route — check for detours or construction.";
    const alert: RouteAlert = {
      id: "hazard-closure-0",
      severity: 90,
      title: "Closure ahead",
      detail: notice,
      lngLat: [-89.5, 39.9],
      zoom: 12.6,
      alongMeters: 80_000,
      promptRerouteAhead: true,
      corridorKind: "hazard",
    };

    const bundle = buildRouteChunkCalloutList({
      geometry,
      totalM,
      userAlongM: 0,
      planEtaMinutes: 300,
      slice: {
        routeId: "a",
        role: "fastest",
        trafficDelayMinutes: 0,
        mapboxDurationMinutes: 300,
        hasLiveTrafficEstimate: true,
        radarIntensity: 0,
        forecastHeadline: "",
        hazards: [{ kind: "closure", summary: notice, alongMeters: 80_000 }],
      },
      weatherSamples: [],
      laidOutAlerts: [alert],
      stormBands: [],
      stripTint: "#3b82f6",
    });

    const hazardRows = bundle.segments.filter((s) => s.key.startsWith("serious-hazard-"));
    const alertRows = bundle.segments.filter((s) => s.key.startsWith("serious-alert-"));
    expect(hazardRows).toHaveLength(0);
    expect(alertRows).toHaveLength(1);
    expect(alertRows[0]!.title).toBe("Closure ahead");
    expect(alertRows[0]!.summary).toBe(notice);
  });

  it("omits whole-route radar row when route outlook timeline is shown", () => {
    const corridorRain: RouteAlert = {
      id: "radar",
      severity: 80,
      title: "Heavy rain on route",
      detail: "Start: 77°F rain → Quarter: 76°F rain",
      lngLat: [-89.5, 39.9],
      zoom: 11.5,
      alongMeters: 100_000,
      promptRerouteAhead: false,
      corridorKind: "weather",
    };
    const localizedRain: RouteAlert = {
      id: "radar-seg-2",
      severity: 75,
      title: "Heavy rain on route",
      detail: "Echo over mile 120–140",
      lngLat: [-89.45, 39.92],
      zoom: 11.5,
      alongMeters: 130_000,
      promptRerouteAhead: false,
      corridorKind: "weather",
    };

    const withTimeline = buildRouteChunkCalloutList({
      geometry,
      totalM,
      userAlongM: 0,
      planEtaMinutes: 300,
      slice: {
        routeId: "a",
        role: "fastest",
        trafficDelayMinutes: 0,
        mapboxDurationMinutes: 300,
        hasLiveTrafficEstimate: true,
        radarIntensity: 0.9,
        forecastHeadline:
          "Start: 77°F rain → Quarter: 76°F rain → Midway: 74°F rain → 3/4 mark: 72°F rain → Destination: 71°F clear",
        hazards: [],
      },
      weatherSamples: [],
      laidOutAlerts: [corridorRain, localizedRain],
      stormBands: [],
      stripTint: "#3b82f6",
    });

    expect(withTimeline.outlookTimeline.length).toBeGreaterThan(1);
    const alertRows = withTimeline.segments.filter((s) => s.key.startsWith("serious-alert-"));
    expect(alertRows).toHaveLength(1);
    expect(alertRows[0]!.key).toContain("radar-seg-2");
  });
});
