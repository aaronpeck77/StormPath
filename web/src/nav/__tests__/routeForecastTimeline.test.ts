import { describe, expect, it } from "vitest";
import {
  applyRadarOutlookBoost,
  buildOutlookFromStormAlongRoute,
  buildRouteOutlookFromTomorrowForecast,
  buildRouteOutlookTimeline,
  buildRouteOutlookSeries,
  buildSyncedRouteOutlook,
  ensureRouteOutlookForGraph,
  inferPrecipPctFromConditions,
  mergeRouteOutlookSamples,
  mergeRouteOutlookSteps,
  precipBarHeight,
  radarIntensityToPrecipPct,
  resolveRouteOutlookAnchorTempF,
  routeOutlookAriaLabel,
  tomorrowForecastToWxSamples,
} from "../routeForecastTimeline";
import type { RouteForecast } from "../../services/tomorrowIo";

describe("buildRouteOutlookTimeline", () => {
  it("parses quarter-style forecast headlines into five stops", () => {
    const headline =
      "Start: 77°F overcast clouds → Quarter (in ~1 hr 21 min): 76°F light rain 58% precip → Midway (in ~2 hr 40 min): 74°F rain 72% precip → 3/4 mark (in ~4 hr): 72°F clouds → Destination: 71°F clear sky";
    const steps = buildRouteOutlookTimeline(headline);
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.shortLabel)).toEqual(["Go", "¼", "Mid", "¾", "End"]);
    expect(steps[0]?.tempF).toBe(77);
    expect(steps[1]?.precipPct).toBe(58);
    expect(steps[1]?.etaLabel).toBe("1 hr 21 min");
    expect(steps[1]?.icon).toBe("🌧");
  });

  it("falls back to weather samples when headline is not segmented", () => {
    const steps = buildRouteOutlookTimeline("clear sky; clouds 20%", [
      { t: 0, headline: "72°F clear sky; clouds 10%", precipHint: 0.1 },
      { t: 0.5, headline: "68°F light rain; clouds 80%", precipHint: 0.72 },
      { t: 1, headline: "70°F overcast clouds; clouds 90%", precipHint: 0.55 },
    ]);
    expect(steps).toHaveLength(5);
    expect(steps[2]?.conditions).toMatch(/rain/i);
    expect(precipBarHeight(steps[2]!)).toBeGreaterThan(40);
  });

  it("builds an accessible summary line", () => {
    const steps = buildRouteOutlookTimeline(
      "Start: 70°F clear → Destination: 65°F rain 40% precip"
    );
    const aria = routeOutlookAriaLabel(steps);
    expect(aria).toContain("Go");
    expect(aria).toContain("End");
    expect(aria).toContain("70°F");
  });
});

describe("buildSyncedRouteOutlook", () => {
  it("adds along-route meters and drive-synced ETAs", () => {
    const steps = buildSyncedRouteOutlook({
      forecastHeadline: "",
      samples: [
        { t: 0, headline: "72°F clear sky", precipHint: 0 },
        { t: 0.5, headline: "68°F light rain", precipHint: 0.5 },
        { t: 1, headline: "70°F clouds", precipHint: 0.2 },
      ],
      totalMeters: 160_934,
      userAlongMeters: 0,
      planEtaMinutes: 120,
      driveEtaMinutes: null,
    });
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0]?.alongMeters).toBe(0);
    expect(steps[0]?.etaLabel).toBe("Now");
    expect(steps[2]?.alongMeters).toBeCloseTo(80_467, -2);
    expect(steps[2]?.etaLabel).toMatch(/hr|min/);
  });
});

describe("tomorrowForecast outlook", () => {
  const forecast: RouteForecast = {
    fetchedAt: Date.now(),
    intervals: [
      {
        etaMinutes: 0,
        lat: 42,
        lng: -90,
        tempF: 75,
        precipIntensityMmh: 0,
        precipProbability: 0.1,
        windSpeedMph: 8,
        windGustMph: 12,
        weatherCode: 1000,
        wetRoadMm: 0,
      },
      {
        etaMinutes: 60,
        lat: 42.1,
        lng: -89,
        tempF: 68,
        precipIntensityMmh: 2,
        precipProbability: 0.55,
        windSpeedMph: 14,
        windGustMph: 20,
        weatherCode: 4200,
        wetRoadMm: 0.2,
      },
      {
        etaMinutes: 120,
        lat: 42.2,
        lng: -88,
        tempF: 62,
        precipIntensityMmh: 5,
        precipProbability: 0.8,
        windSpeedMph: 18,
        windGustMph: 28,
        weatherCode: 4201,
        wetRoadMm: 0.5,
      },
    ],
  };

  it("builds graph samples and five stops from Tomorrow.io corridor data", () => {
    const samples = tomorrowForecastToWxSamples(forecast, 120);
    expect(samples.length).toBe(3);
    expect(samples[0]?.headline).toContain("75°F");
    const steps = buildRouteOutlookFromTomorrowForecast(forecast, 120);
    expect(steps).toHaveLength(5);
    expect(steps[0]?.tempF).toBe(75);
    const series = buildRouteOutlookSeries(steps, samples);
    expect(series.length).toBeGreaterThan(2);
  });
});

describe("inferPrecipPctFromConditions", () => {
  it("estimates rain likelihood from wording when % precip is missing", () => {
    expect(inferPrecipPctFromConditions("light rain")).toBe(65);
    expect(inferPrecipPctFromConditions("thunderstorm with heavy rain")).toBe(75);
  });
});

describe("radar outlook boost", () => {
  it("maps radar echo conservatively (not 1:1 with reflectivity)", () => {
    expect(radarIntensityToPrecipPct(0)).toBe(0);
    expect(radarIntensityToPrecipPct(0.55)).toBeLessThan(50);
    expect(radarIntensityToPrecipPct(0.95)).toBeLessThanOrEqual(88);
  });

  it("boosts only where echo exceeds the rest of the route", () => {
    const clear = buildRouteOutlookTimeline(
      "Start: 80°F clear → Destination: 78°F clear sky"
    );
    const boosted = applyRadarOutlookBoost(clear, [
      { t: 0.1, intensity: 0.05 },
      { t: 0.88, intensity: 0.72 },
    ]);
    const start = boosted.find((s) => s.key === "start");
    const end = boosted.find((s) => s.key === "end");
    expect(start?.precipPct ?? 0).toBe(0);
    expect(end?.precipPct).toBeGreaterThan(0);
    const series = buildRouteOutlookSeries(boosted);
    const head = series.find((p) => p.fraction <= 0.1);
    const tail = series.find((p) => p.fraction >= 0.85);
    expect(head?.precipPct ?? 0).toBeLessThan(20);
    expect(tail?.precipPct).toBeGreaterThan(0);
  });

  it("ignores uniform mosaic noise that would paint the whole route", () => {
    const clear = buildRouteOutlookTimeline(
      "Start: 80°F clear → Destination: 78°F clear sky"
    );
    const boosted = applyRadarOutlookBoost(clear, [
      { t: 0.1, intensity: 0.52 },
      { t: 0.3, intensity: 0.54 },
      { t: 0.5, intensity: 0.53 },
      { t: 0.7, intensity: 0.55 },
      { t: 0.9, intensity: 0.54 },
    ]);
    expect(boosted.every((s) => (s.precipPct ?? 0) === 0)).toBe(true);
  });
});

describe("buildRouteOutlookSeries", () => {
  it("shows rain toward destination when headline omits % precip", () => {
    const steps = buildRouteOutlookTimeline(
      "Start: 80°F clear sky → Destination: 68°F rain"
    );
    const series = buildRouteOutlookSeries(steps);
    const end = series.find((p) => p.fraction >= 0.95);
    expect(end?.precipPct).toBeGreaterThan(0);
  });

  it("interpolates temp and precip between along-route forecast stops", () => {
    const steps = buildSyncedRouteOutlook({
      forecastHeadline:
        "Start: 80°F clear → Quarter (in ~1 hr): 76°F light rain 40% precip → Destination: 70°F rain 70% precip",
      totalMeters: 100_000,
      userAlongMeters: 0,
      planEtaMinutes: 120,
    });
    const series = buildRouteOutlookSeries(steps);
    expect(series.length).toBeGreaterThan(steps.length);
    const mid = series.find((p) => p.fraction >= 0.45 && p.fraction <= 0.55);
    expect(mid?.tempF).toBeGreaterThan(70);
    expect(mid?.tempF).toBeLessThan(80);
    expect(mid?.precipPct).toBeGreaterThan(0);
  });

  it("renders a line from a single along-route forecast stop", () => {
    const steps = buildRouteOutlookTimeline("72°F light rain 45% precip");
    expect(steps.length).toBeGreaterThanOrEqual(2);
    const series = buildRouteOutlookSeries(steps);
    expect(series.length).toBeGreaterThanOrEqual(2);
    expect(series.some((p) => p.precipPct > 0)).toBe(true);
  });
});

describe("mergeRouteOutlookSteps", () => {
  it("maps a single mid-route headline stop onto the graph axis", () => {
    const single = buildRouteOutlookTimeline("68°F rain 60% precip");
    const merged = mergeRouteOutlookSteps(single);
    expect(merged.length).toBeGreaterThanOrEqual(2);
    expect(merged.some((s) => (s.precipPct ?? 0) > 0 || s.precipHint > 0)).toBe(true);
  });
});

describe("ensureRouteOutlookForGraph", () => {
  it("fills graph from storm bands when forecast APIs are empty", () => {
    const ensured = ensureRouteOutlookForGraph({
      steps: [],
      samples: [],
      headline: "",
      totalMeters: 40_000,
      stormBands: [
        { startMeters: 8_000, endMeters: 18_000, headline: "Severe Thunderstorm Warning" },
        { startMeters: 22_000, endMeters: 30_000, headline: "Heavy rain on route" },
      ],
    });
    const series = buildRouteOutlookSeries(ensured.steps, ensured.samples);
    expect(series.length).toBeGreaterThan(1);
    expect(Math.max(...series.map((p) => p.precipPct))).toBeGreaterThan(40);
  });

  it("adds a temperature line when storm bands supply rain only", () => {
    const ensured = ensureRouteOutlookForGraph({
      steps: [],
      samples: [],
      headline: "",
      totalMeters: 40_000,
      stormBands: [
        { startMeters: 8_000, endMeters: 18_000, headline: "Severe Thunderstorm Warning" },
        { startMeters: 22_000, endMeters: 30_000, headline: "Heavy rain on route" },
      ],
      anchorTempF: 72,
    });
    const series = buildRouteOutlookSeries(ensured.steps, ensured.samples);
    expect(series.some((p) => p.tempF != null)).toBe(true);
  });

  it("backfills temp on storm-only steps from corridor samples", () => {
    const ensured = ensureRouteOutlookForGraph({
      steps: buildOutlookFromStormAlongRoute({
        totalMeters: 50_000,
        stormBands: [{ startMeters: 10_000, endMeters: 20_000, headline: "Heavy rain on route" }],
      }),
      samples: [
        { t: 0, precipHint: 0.2, headline: "68°F light rain 40% precip" },
        { t: 0.5, precipHint: 0.5, headline: "62°F rain 55% precip" },
        { t: 1, precipHint: 0.1, headline: "58°F clouds 10% precip" },
      ],
      headline: "",
      totalMeters: 50_000,
    });
    const series = buildRouteOutlookSeries(ensured.steps, ensured.samples);
    expect(series.filter((p) => p.tempF != null).length).toBeGreaterThan(1);
  });

  it("fills the graph when only text mentions rain and temp", () => {
    const ensured = ensureRouteOutlookForGraph({
      steps: [],
      samples: [],
      headline: "Start: 74°F showers 50% precip → Destination: 66°F rain 70% precip",
    });
    expect(ensured.steps.length).toBeGreaterThanOrEqual(2);
    const series = buildRouteOutlookSeries(ensured.steps, ensured.samples);
    expect(series.length).toBeGreaterThanOrEqual(2);
    expect(series.some((p) => p.precipPct > 0)).toBe(true);
  });

  it("uses Tomorrow.io temps when OpenWeather hints lack °F", () => {
    const forecast: RouteForecast = {
      fetchedAt: Date.now(),
      intervals: [
        {
          etaMinutes: 0,
          lat: 42,
          lng: -89,
          tempF: 70,
          precipIntensityMmh: 0,
          precipProbability: 0.2,
          windSpeedMph: 10,
          windGustMph: 14,
          weatherCode: 1001,
          wetRoadMm: 0,
        },
        {
          etaMinutes: 60,
          lat: 42.1,
          lng: -88.5,
          tempF: 64,
          precipIntensityMmh: 2,
          precipProbability: 0.55,
          windSpeedMph: 12,
          windGustMph: 18,
          weatherCode: 4000,
          wetRoadMm: 0.1,
        },
        {
          etaMinutes: 120,
          lat: 42.2,
          lng: -88,
          tempF: 58,
          precipIntensityMmh: 1,
          precipProbability: 0.1,
          windSpeedMph: 8,
          windGustMph: 12,
          weatherCode: 1100,
          wetRoadMm: 0,
        },
      ],
    };
    const ensured = ensureRouteOutlookForGraph({
      steps: buildOutlookFromStormAlongRoute({
        totalMeters: 50_000,
        stormBands: [{ startMeters: 10_000, endMeters: 20_000, headline: "Heavy rain on route" }],
      }),
      samples: [
        { t: 0, precipHint: 0.4, headline: "heavy rain" },
        { t: 0.5, precipHint: 0.6, headline: "thunderstorms" },
        { t: 1, precipHint: 0.2, headline: "light rain" },
      ],
      headline: "",
      tioRouteForecast: forecast,
      planEtaMinutes: 120,
    });
    const series = buildRouteOutlookSeries(ensured.steps, ensured.samples);
    expect(series.filter((p) => p.tempF != null).length).toBeGreaterThan(1);
    expect(Math.max(...series.map((p) => p.tempF ?? 0))).toBeGreaterThan(60);
  });
});

describe("mergeRouteOutlookSamples", () => {
  it("prefers samples that include temperature", () => {
    const merged = mergeRouteOutlookSamples(
      [{ t: 0.5, precipHint: 0.7, headline: "Heavy rain on route" }],
      [{ t: 0.5, precipHint: 0.5, headline: "62°F rain 55% precip" }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.headline).toContain("62°F");
  });
});

describe("resolveRouteOutlookAnchorTempF", () => {
  it("falls back through nowcast, minute precip, headline, and TIO", () => {
    expect(resolveRouteOutlookAnchorTempF({ nowcastTempF: 71 })).toBe(71);
    expect(resolveRouteOutlookAnchorTempF({ minutePrecipTempF: 68 })).toBe(68);
    expect(resolveRouteOutlookAnchorTempF({ hourlyTempF: 63 })).toBe(63);
    expect(
      resolveRouteOutlookAnchorTempF({ headline: "74°F light rain 40% precip" })
    ).toBe(74);
    expect(
      resolveRouteOutlookAnchorTempF({
        tioRouteForecast: {
          fetchedAt: Date.now(),
          intervals: [
            {
              etaMinutes: 0,
              lat: 42,
              lng: -89,
              tempF: 66,
              precipIntensityMmh: 0,
              precipProbability: 0,
              windSpeedMph: 8,
              windGustMph: 10,
              weatherCode: 1000,
              wetRoadMm: 0,
            },
          ],
        },
      })
    ).toBe(66);
  });
});

describe("buildRouteOutlookSeries temp backfill", () => {
  it("borrows °F from samples when storm stops only have rain", () => {
    const steps = buildOutlookFromStormAlongRoute({
      totalMeters: 50_000,
      stormBands: [{ startMeters: 10_000, endMeters: 20_000, headline: "Heavy rain on route" }],
    });
    const samples = [
      { t: 0, precipHint: 0.2, headline: "68°F light rain 40% precip" },
      { t: 0.5, precipHint: 0.5, headline: "62°F rain 55% precip" },
      { t: 1, precipHint: 0.1, headline: "58°F clouds 10% precip" },
    ];
    const series = buildRouteOutlookSeries(steps, samples);
    expect(series.filter((p) => p.tempF != null).length).toBeGreaterThan(1);
  });
});
