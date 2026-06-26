/**
 * Converts a Tomorrow.io RouteForecast into RouteImpact[] that can be merged
 * into the existing hazard timeline.
 *
 * Strategy: consecutive waypoints with the same severity are merged into a
 * single band. Only caution-or-worse bands are emitted (clear weather → skip).
 */

import type { RouteForecast, RouteHourlyInterval } from "../services/tomorrowIo";
import { weatherCodeLabel, weatherCodeSeverity } from "../services/tomorrowIo";
import {
  gustSpikeSeverity,
  sustainedWindImpactSeverity,
  WIND_GUST_SPIKE_MAX_ROUTE_FRAC,
  WIND_SUSTAINED_AVOID_MPH,
  WIND_SUSTAINED_SERIOUS_MPH,
} from "./windForecastCalib";
import type { RouteImpact, RouteImpactCategory, RouteImpactSeverity } from "./routeImpacts";
import { pointAtAlongMeters } from "./routeGeometry";
import type { LngLat } from "./types";

const SEVERITY_TO_NUMERIC: Record<RouteImpactSeverity, number> = {
  info: 20,
  caution: 45,
  serious: 70,
  avoid: 90,
};

function convectiveSeverity(iv: RouteHourlyInterval): RouteImpactSeverity | null {
  if (iv.hailSizeMm != null && iv.hailSizeMm >= 15) return "avoid";
  if (iv.hailProbability != null && iv.hailProbability >= 0.45) return "serious";
  if (iv.lightningFlashRate != null && iv.lightningFlashRate >= 0.35) return "serious";
  if (iv.lightningFlashRate != null && iv.lightningFlashRate >= 0.12) return "caution";
  if (iv.hailSizeMm != null && iv.hailSizeMm >= 5) return "caution";
  return null;
}

function categoryFromInterval(iv: RouteHourlyInterval): RouteImpactCategory {
  const code = iv.weatherCode;
  if (convectiveSeverity(iv)) return "weather";
  if ([5000, 5001, 5100, 5101, 6000, 6001, 6200, 6201, 7000, 7101, 7102].includes(code)) return "winter";
  if (iv.precipIntensityMmh >= 1) return "weather";
  if (sustainedWindImpactSeverity(iv.windSpeedMph)) return "wind";
  if (iv.wetRoadMm >= 2) return "flooding";
  return "weather";
}

function detailFromInterval(iv: RouteHourlyInterval): string {
  const parts: string[] = [weatherCodeLabel(iv.weatherCode)];
  if (iv.lightningFlashRate != null && iv.lightningFlashRate >= 0.08) {
    parts.push("lightning nearby");
  }
  if (iv.hailProbability != null && iv.hailProbability >= 0.2) {
    parts.push(`${Math.round(iv.hailProbability * 100)}% hail risk`);
  }
  if (iv.hailSizeMm != null && iv.hailSizeMm >= 2) {
    parts.push(`hail to ${iv.hailSizeMm.toFixed(0)} mm`);
  }
  if (iv.precipIntensityMmh > 0) {
    const mm = iv.precipIntensityMmh.toFixed(1);
    parts.push(`precip ${mm} mm/hr`);
  }
  if (gustSpikeSeverity(iv.windSpeedMph, iv.windGustMph)) {
    parts.push(`gusts to ${Math.round(iv.windGustMph)} mph`);
  } else if (sustainedWindImpactSeverity(iv.windSpeedMph)) {
    parts.push(`wind ${Math.round(iv.windSpeedMph)} mph`);
  }
  if (iv.wetRoadMm >= 1) parts.push(`standing water ${iv.wetRoadMm.toFixed(1)} mm`);
  parts.push(`${Math.round(iv.tempF)}°F`);
  return parts.join(" · ");
}

function headlineFromInterval(iv: RouteHourlyInterval): string {
  const label = weatherCodeLabel(iv.weatherCode);
  // Only call something "Hazardous" when there is actual precipitation or winter weather.
  // High wind with clear sky is handled by the Wind track; labelling it "Hazardous: Mostly cloudy"
  // is confusing and redundant.
  const hasPrecip = iv.precipIntensityMmh > 0.05;
  const sev = weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windSpeedMph);
  if (hasPrecip && (sev === "avoid" || sev === "serious")) return `Hazardous: ${label}`;
  return label;
}

function isLightPrecipInterval(iv: RouteHourlyInterval): boolean {
  const label = weatherCodeLabel(iv.weatherCode).toLowerCase();
  return (
    iv.precipIntensityMmh > 0.05 &&
    iv.precipIntensityMmh < 2.5 &&
    (label.includes("rain") || label.includes("drizzle"))
  );
}

function forecastHeadlineForBand(
  rep: RouteHourlyInterval,
  worstSev: RouteImpactSeverity,
  spanFrac: number
): string {
  const label = weatherCodeLabel(rep.weatherCode);
  const longBand = spanFrac >= 0.25;
  if (worstSev === "avoid" || worstSev === "serious") {
    return longBand ? `Hazardous weather along much of your route` : `Hazardous: ${label}`;
  }
  if (isLightPrecipInterval(rep) && longBand) {
    return "Light rain along much of your route";
  }
  if (
    longBand &&
    (label.toLowerCase().includes("rain") || label.toLowerCase().includes("drizzle"))
  ) {
    return "Rain along much of your route";
  }
  return headlineFromInterval(rep);
}

/**
 * Converts Tomorrow.io route forecast into RouteImpact[] for hazard timeline.
 *
 * @param forecast   The RouteForecast returned by fetchRouteForecast.
 * @param geometry   Active route geometry (LngLat[]).
 * @param totalEtaMin  Total planned trip time in minutes (used to map ETA → meter position).
 * @param totalMeters  Total route length in meters.
 */
export function routeForecastToImpacts(
  forecast: RouteForecast,
  geometry: LngLat[],
  totalEtaMin: number,
  totalMeters: number
): RouteImpact[] {
  if (!forecast.intervals.length || totalEtaMin <= 0 || totalMeters <= 0) return [];

  // Map each interval to its route position and severity.
  type Annotated = {
    iv: RouteHourlyInterval;
    startM: number;
    endM: number;
    sev: RouteImpactSeverity;
    cat: RouteImpactCategory;
  };

  const annotated: Annotated[] = forecast.intervals
    .map((iv, i) => {
      const frac = iv.etaMinutes / totalEtaMin;
      const startM = Math.min(totalMeters, Math.max(0, frac * totalMeters));
      // End = midpoint to next interval (or end of route).
      const nextFrac =
        i + 1 < forecast.intervals.length
          ? (forecast.intervals[i + 1]!.etaMinutes / totalEtaMin)
          : 1;
      const endM = Math.min(totalMeters, nextFrac * totalMeters);
      const sev =
        convectiveSeverity(iv) ??
        weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windSpeedMph);
      const cat = categoryFromInterval(iv);
      return { iv, startM, endM, sev, cat };
    })
    // Only show caution-or-worse in the forecast strip — light/info-level rain is already
    // visible in the route graph above and doesn't need a full-width strip band of its own.
    .filter((a) => a.sev !== "info");

  if (!annotated.length) return [];

  // Merge consecutive light-precip / same-severity segments into bands for the graph.
  const bands: Annotated[][] = [];
  let current: Annotated[] = [annotated[0]!];
  for (let i = 1; i < annotated.length; i++) {
    const prev = current[current.length - 1]!;
    const curr = annotated[i]!;
    const adjacent = curr.startM <= prev.endM + 500;
    const sameSeverity = curr.sev === prev.sev;
    const bothLightPrecip = isLightPrecipInterval(prev.iv) && isLightPrecipInterval(curr.iv);
    if (adjacent && (sameSeverity || bothLightPrecip)) {
      current.push(curr);
    } else {
      bands.push(current);
      current = [curr];
    }
  }
  bands.push(current);

  const impacts: RouteImpact[] = bands.map((band, i) => {
    const first = band[0]!;
    const last = band[band.length - 1]!;
    const startM = first.startM;
    const endM = last.endM;
    const midM = (startM + endM) / 2;

    // Pick the worst severity in the band.
    const sevOrder: RouteImpactSeverity[] = ["info", "caution", "serious", "avoid"];
    const worstSev = band.reduce<RouteImpactSeverity>((best, a) => {
      return sevOrder.indexOf(a.sev) > sevOrder.indexOf(best) ? a.sev : best;
    }, "info");

    // Representative interval = the one with the highest precip or wind.
    const rep = band.reduce((best, a) =>
      a.iv.precipIntensityMmh + a.iv.windSpeedMph * 0.1 >
      best.iv.precipIntensityMmh + best.iv.windSpeedMph * 0.1
        ? a
        : best
    );

    const lngLat = pointAtAlongMeters(geometry, midM);
    const etaAheadMin = first.iv.etaMinutes;
    const spanFrac = totalMeters > 0 ? (endM - startM) / totalMeters : 0;

    return {
      id: `tio-${i}-${first.iv.etaMinutes}`,
      category: rep.cat,
      severity: worstSev,
      confidence: "medium",
      source: "tomorrowIo",
      lngLat,
      alongMeters: midM,
      startMeters: startM,
      endMeters: endM,
      distanceAheadMeters: startM,
      etaAheadMinutes: etaAheadMin,
      driverHeadline: forecastHeadlineForBand(rep.iv, worstSev, spanFrac),
      driverAction: worstSev === "avoid" || worstSev === "serious" ? "prepare" : "watch",
      roadEffect: detailFromInterval(rep.iv),
      detail:
        spanFrac >= 0.25
          ? `${forecastHeadlineForBand(rep.iv, worstSev, spanFrac)} · ~${Math.round(spanFrac * 100)}% of route`
          : detailFromInterval(rep.iv),
      numericSeverity: SEVERITY_TO_NUMERIC[worstSev],
    };
  });

  return impacts;
}

function intervalSpanMeters(
  intervals: RouteHourlyInterval[],
  index: number,
  totalEtaMin: number,
  totalMeters: number
): { startM: number; endM: number } {
  const iv = intervals[index]!;
  const frac = iv.etaMinutes / totalEtaMin;
  const startM = Math.min(totalMeters, Math.max(0, frac * totalMeters));
  const nextFrac =
    index + 1 < intervals.length ? intervals[index + 1]!.etaMinutes / totalEtaMin : 1;
  const endM = Math.min(totalMeters, nextFrac * totalMeters);
  return { startM, endM };
}

function clampBandSpan(
  startM: number,
  endM: number,
  totalMeters: number,
  maxFrac: number
): { startM: number; endM: number } {
  const maxSpan = totalMeters * maxFrac;
  const span = endM - startM;
  if (span <= maxSpan || totalMeters <= 0) return { startM, endM };
  const mid = (startM + endM) / 2;
  return { startM: Math.max(0, mid - maxSpan / 2), endM: Math.min(totalMeters, mid + maxSpan / 2) };
}

function sustainedWindHeadline(speedMph: number): string {
  const s = Math.round(speedMph);
  if (speedMph >= WIND_SUSTAINED_AVOID_MPH) return `Dangerous sustained wind — ${s} mph`;
  if (speedMph >= WIND_SUSTAINED_SERIOUS_MPH) return `High sustained wind — ${s} mph`;
  return `Sustained wind — ${s} mph`;
}

function gustSpikeHeadline(gustMph: number, speedMph: number): string {
  return `Gusts to ${Math.round(gustMph)} mph (wind ${Math.round(speedMph)} mph)`;
}

function buildSustainedWindImpacts(
  forecast: RouteForecast,
  geometry: LngLat[],
  totalEtaMin: number,
  totalMeters: number
): RouteImpact[] {
  const intervals = forecast.intervals ?? [];
  if (!intervals.length || totalEtaMin <= 0 || totalMeters <= 0) return [];

  type WindSlice = { iv: RouteHourlyInterval; startM: number; endM: number };
  const slices: WindSlice[] = [];

  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i]!;
    if (sustainedWindImpactSeverity(iv.windSpeedMph) === null) continue;
    const { startM, endM } = intervalSpanMeters(intervals, i, totalEtaMin, totalMeters);
    slices.push({ iv, startM, endM });
  }
  if (!slices.length) return [];

  type Band = { slices: WindSlice[]; sev: RouteImpactSeverity };
  const bands: Band[] = [];
  for (const slice of slices) {
    const sev = sustainedWindImpactSeverity(slice.iv.windSpeedMph)!;
    const last = bands[bands.length - 1];
    if (last && last.sev === sev && slice.startM <= last.slices[last.slices.length - 1]!.endM + 5000) {
      last.slices.push(slice);
    } else {
      bands.push({ slices: [slice], sev });
    }
  }

  return bands.map((band, i) => {
    const first = band.slices[0]!;
    const last = band.slices[band.slices.length - 1]!;
    let startM = first.startM;
    let endM = last.endM;
    const midM = (startM + endM) / 2;
    const rep = band.slices.reduce((b, s) => (s.iv.windSpeedMph > b.iv.windSpeedMph ? s : b));
    const lngLat = pointAtAlongMeters(geometry, midM);
    const spanFrac = totalMeters > 0 ? (endM - startM) / totalMeters : 0;
    const headline = sustainedWindHeadline(rep.iv.windSpeedMph);
    const detail =
      spanFrac >= 0.25 && (band.sev === "serious" || band.sev === "avoid")
        ? `${headline} · ~${Math.round(spanFrac * 100)}% of route`
        : headline;

    return {
      id: `wind-sust-${i}-${Math.round(startM)}`,
      category: "wind" as RouteImpactCategory,
      severity: band.sev,
      confidence: "medium" as const,
      source: "wind" as const,
      lngLat,
      alongMeters: midM,
      startMeters: startM,
      endMeters: endM,
      distanceAheadMeters: startM,
      etaAheadMinutes: first.iv.etaMinutes,
      driverHeadline: headline,
      driverAction: band.sev === "avoid" ? "prepare" : "watch",
      roadEffect: detail,
      detail,
      numericSeverity: SEVERITY_TO_NUMERIC[band.sev],
    } as RouteImpact;
  });
}

function buildGustSpikeImpacts(
  forecast: RouteForecast,
  geometry: LngLat[],
  totalEtaMin: number,
  totalMeters: number
): RouteImpact[] {
  const intervals = forecast.intervals ?? [];
  if (!intervals.length || totalEtaMin <= 0 || totalMeters <= 0) return [];

  const impacts: RouteImpact[] = [];
  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i]!;
    if (gustSpikeSeverity(iv.windSpeedMph, iv.windGustMph) === null) continue;
    let { startM, endM } = intervalSpanMeters(intervals, i, totalEtaMin, totalMeters);
    ({ startM, endM } = clampBandSpan(startM, endM, totalMeters, WIND_GUST_SPIKE_MAX_ROUTE_FRAC));
    const midM = (startM + endM) / 2;
    const lngLat = pointAtAlongMeters(geometry, midM);
    const headline = gustSpikeHeadline(iv.windGustMph, iv.windSpeedMph);

    impacts.push({
      id: `wind-gust-${i}-${Math.round(startM)}`,
      category: "wind" as RouteImpactCategory,
      severity: "caution",
      confidence: "medium" as const,
      source: "windGust" as const,
      lngLat,
      alongMeters: midM,
      startMeters: startM,
      endMeters: endM,
      distanceAheadMeters: startM,
      etaAheadMinutes: iv.etaMinutes,
      driverHeadline: headline,
      driverAction: "watch",
      roadEffect: headline,
      detail: headline,
      numericSeverity: SEVERITY_TO_NUMERIC.caution,
    });
  }
  return impacts;
}

/**
 * Sustained wind drives corridor hazard bands; gust spikes are short localized cautions.
 */
export function buildWindImpacts(
  forecast: RouteForecast,
  geometry: LngLat[],
  totalEtaMin: number,
  totalMeters: number
): RouteImpact[] {
  return [
    ...buildSustainedWindImpacts(forecast, geometry, totalEtaMin, totalMeters),
    ...buildGustSpikeImpacts(forecast, geometry, totalEtaMin, totalMeters),
  ];
}

/**
 * One-line forecast summary item — shown at the top of the advisory list
 * instead of the old per-segment "Forecast" bars.
 *
 * Only covers PRECIPITATION-based hazards. Wind is handled entirely by buildWindImpacts
 * so wind-only intervals (clear sky + gusts) are excluded here to avoid duplication and
 * nonsensical entries like "Hazardous: Mostly cloudy".
 *
 * Returns null when the route forecast has no meaningful precipitation.
 */
export function buildForecastSummary(
  forecast: RouteForecast,
  geometry: LngLat[],
  totalEtaMin: number,
  totalMeters: number
): RouteImpact | null {
  const allImpacts = routeForecastToImpacts(forecast, geometry, totalEtaMin, totalMeters);

  // Keep only precipitation-driven impacts. Wind-only intervals (category "wind",
  // or clear sky with near-zero precip) are already surfaced by the Wind track.
  const precipImpacts = allImpacts.filter(
    (imp) => imp.category !== "wind");
  if (!precipImpacts.length) return null;

  // Also skip if the only remaining impacts are "info"-level clear-weather entries
  // (nothing worth surfacing as a summary).
  const meaningful = precipImpacts.filter((imp) => (imp.numericSeverity ?? 0) >= 40);
  if (!meaningful.length) return null;

  const worst = meaningful.reduce((b, i) =>
    (i.numericSeverity ?? 0) >= (b.numericSeverity ?? 0) ? i : b
  );
  const totalCoverM = meaningful.reduce((s, i) => s + (i.endMeters - i.startMeters), 0);
  const coverFrac = totalMeters > 0 ? Math.min(1, totalCoverM / totalMeters) : 0;
  const coverSuffix = coverFrac >= 0.75 ? "along most of route"
    : coverFrac >= 0.4 ? `along ~${Math.round(coverFrac * 100)}% of route`
    : null;
  const headline = coverSuffix
    ? `${worst.driverHeadline} — ${coverSuffix}`
    : worst.driverHeadline;
  const midM = totalMeters / 2;
  return {
    ...worst,
    id: "forecast-summary",
    source: "tomorrowIo" as const,
    alongMeters: midM,
    startMeters: 0,
    endMeters: totalMeters,
    driverHeadline: headline,
    detail: worst.detail ?? worst.driverHeadline,
  };
}
