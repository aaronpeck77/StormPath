import { describe, expect, it } from "vitest";
import {
  applyRadarOutlookBoost,
  buildOutlookFromStormAlongRoute,
  buildRouteOutlookSeries,
  buildSyncedRouteOutlook,
  ensureRouteOutlookForGraph,
  mergeRouteOutlookSteps,
  resolveRouteOutlookAnchorTempF,
  resyncRouteOutlookSteps,
  tomorrowForecastToWxSamples,
} from "../routeForecastTimeline";
import {
  repairRouteForecastTemps,
  type RouteForecast,
} from "../../services/tomorrowIo";

const PLAN_ETA = 1066; // ~17.8h — Champaign→Stuart
const TOTAL_M = 1_873_000;

function makeForecast(
  tempF: number | null,
  poisonIdxs: number[] = []
): RouteForecast {
  const intervals = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1.0].map(
    (f, i) => ({
      etaMinutes: Math.round(PLAN_ETA * f),
      lat: 40 + f * -13,
      lng: -88 + f * 8,
      tempF:
        tempF == null || poisonIdxs.includes(i) ? NaN : tempF + f * 4,
      feelsLikeF: tempF == null ? NaN : tempF + f * 4 - 2,
      precipIntensityMmh: 0,
      precipProbability: 0,
      windSpeedMph: 8 + f * 6,
      windGustMph: 14 + f * 6,
      weatherCode: 1000,
      wetRoadMm: 0,
    })
  );
  return { fetchedAt: Date.now(), intervals };
}

function runUltraLongBranch(opts: {
  forecast: RouteForecast | null;
  headline?: string;
  radarSamples?: { t: number; intensity: number }[];
  anchorSources?: { nowcastTempF?: number | null; hourlyTempF?: number | null };
}) {
  const { forecast, headline = "", radarSamples = [] } = opts;
  const samples =
    forecast && PLAN_ETA > 0 ? tomorrowForecastToWxSamples(forecast, PLAN_ETA) : [];
  const stormOutlook = buildOutlookFromStormAlongRoute({
    totalMeters: TOTAL_M,
    stormBands: [],
    radarSamples,
  });
  const tioOutlook =
    forecast && PLAN_ETA > 0
      ? buildSyncedRouteOutlook({
          forecastHeadline: "",
          samples,
          totalMeters: TOTAL_M,
          userAlongMeters: 0,
          planEtaMinutes: PLAN_ETA,
          driveEtaMinutes: null,
        })
      : [];
  const syncedOutlook =
    samples.length || headline
      ? buildSyncedRouteOutlook({
          forecastHeadline: headline,
          samples,
          totalMeters: TOTAL_M,
          userAlongMeters: 0,
          planEtaMinutes: PLAN_ETA,
          driveEtaMinutes: null,
        })
      : [];
  const outlookTimeline = resyncRouteOutlookSteps(
    applyRadarOutlookBoost(
      mergeRouteOutlookSteps(syncedOutlook, tioOutlook, stormOutlook),
      radarSamples
    ),
    {
      samples,
      totalMeters: TOTAL_M,
      userAlongMeters: 0,
      planEtaMinutes: PLAN_ETA,
      driveEtaMinutes: null,
    }
  );
  const anchorTempF = resolveRouteOutlookAnchorTempF({
    nowcastTempF: opts.anchorSources?.nowcastTempF,
    minutePrecipTempF: null,
    hourlyTempF: opts.anchorSources?.hourlyTempF,
    headline,
    tioRouteForecast: forecast,
  });
  const ensured = ensureRouteOutlookForGraph({
    steps: outlookTimeline,
    samples,
    headline,
    totalMeters: TOTAL_M,
    stormBands: [],
    radarSamples,
    anchorTempF,
    tioRouteForecast: forecast,
    planEtaMinutes: PLAN_ETA,
  });
  const series = buildRouteOutlookSeries(ensured.steps, ensured.samples);
  return { outlookTimeline, ensured, series, samples, anchorTempF };
}

describe("repairRouteForecastTemps", () => {
  it("fills scattered NaN temps from nearest finite neighbors", () => {
    const f = makeForecast(58, [0, 4, 8]);
    const repaired = repairRouteForecastTemps(f);
    expect(repaired.intervals.every((iv) => Number.isFinite(iv.tempF))).toBe(true);
    // middle NaN borrows a neighbor's interpolated temp, not a constant
    expect(repaired.intervals[4]!.tempF).toBeGreaterThan(55);
    expect(repaired.intervals[4]!.tempF).toBeLessThan(64);
  });

  it("repairs tempF:null after a JSON cache round-trip", () => {
    const f = makeForecast(58, [2, 3]);
    const roundTripped = JSON.parse(JSON.stringify(f)) as RouteForecast;
    expect(roundTripped.intervals[2]!.tempF).toBeNull();
    const repaired = repairRouteForecastTemps(roundTripped);
    expect(repaired.intervals.every((iv) => Number.isFinite(iv.tempF))).toBe(true);
  });

  it("leaves an already-finite forecast untouched (same object)", () => {
    const f = makeForecast(58);
    expect(repairRouteForecastTemps(f)).toBe(f);
  });

  it("keeps NaN when no interval anywhere has a temp (honest, not invented)", () => {
    const f = makeForecast(null);
    const repaired = repairRouteForecastTemps(f);
    expect(repaired.intervals.every((iv) => !Number.isFinite(iv.tempF))).toBe(true);
  });
});

describe("ultra-long outlook pipeline (b616 field case)", () => {
  it("A: real interval temps → temp lane draws", () => {
    const r = runUltraLongBranch({ forecast: makeForecast(58) });
    const temps = r.series.map((p) => p.tempF).filter((t) => t != null);
    expect(temps.length).toBeGreaterThan(2);
  });

  it("B: NaN interval temps + nowcast anchor → rescued flat line", () => {
    const r = runUltraLongBranch({
      forecast: makeForecast(null),
      anchorSources: { nowcastTempF: 57 },
    });
    const temps = r.series.map((p) => p.tempF).filter((t) => t != null);
    expect(temps.length).toBeGreaterThan(2);
  });

  it("C: repaired forecast with scattered NaN → temp lane draws", () => {
    const repaired = repairRouteForecastTemps(makeForecast(58, [0, 4, 8]));
    const r = runUltraLongBranch({ forecast: repaired });
    const temps = r.series.map((p) => p.tempF).filter((t) => t != null);
    expect(temps.length).toBeGreaterThan(2);
  });

  it("D: real temps + radar samples present → temp still draws", () => {
    const r = runUltraLongBranch({
      forecast: makeForecast(58),
      radarSamples: [
        { t: 0.7, intensity: 0.6 },
        { t: 0.85, intensity: 0.8 },
      ],
    });
    const temps = r.series.map((p) => p.tempF).filter((t) => t != null);
    expect(temps.length).toBeGreaterThan(2);
  });
});
