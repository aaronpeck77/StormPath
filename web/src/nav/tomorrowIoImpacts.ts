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
  windImpactSeverity,
  WIND_GUST_CAUTION_MPH,
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

function categoryFromInterval(iv: RouteHourlyInterval): RouteImpactCategory {
  const code = iv.weatherCode;
  if ([5000, 5001, 5100, 5101, 6000, 6001, 6200, 6201, 7000, 7101, 7102].includes(code)) return "winter";
  if (iv.precipIntensityMmh >= 1) return "weather";
  if (iv.windGustMph >= WIND_GUST_CAUTION_MPH) return "wind";
  if (iv.wetRoadMm >= 2) return "flooding";
  return "weather";
}

function detailFromInterval(iv: RouteHourlyInterval): string {
  const parts: string[] = [weatherCodeLabel(iv.weatherCode)];
  if (iv.precipIntensityMmh > 0) {
    const mm = iv.precipIntensityMmh.toFixed(1);
    parts.push(`precip ${mm} mm/hr`);
  }
  if (iv.windGustMph >= WIND_GUST_CAUTION_MPH) parts.push(`gusts ${Math.round(iv.windGustMph)} mph`);
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
  const sev = weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windGustMph);
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
      const sev = weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windGustMph);
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
      a.iv.precipIntensityMmh + a.iv.windGustMph * 0.1 >
      best.iv.precipIntensityMmh + best.iv.windGustMph * 0.1
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

/** Wind gust severity thresholds (mph) — calibrated gusts, driving-oriented. */
function windSeverity(gustMph: number): RouteImpactSeverity | null {
  return windImpactSeverity(gustMph);
}

function windHeadline(gustMph: number, speedMph: number): string {
  const g = Math.round(gustMph);
  const s = Math.round(speedMph);
  if (gustMph >= 60) return `Dangerous Wind — gusts ${g} mph`;
  if (gustMph >= 48) return `High Wind — gusts ${g} mph`;
  return `Windy — gusts ${g} mph (wind ${s} mph)`;
}

/**
 * Build wind-track RouteImpacts from ETA-aligned route forecast intervals.
 * Consecutive waypoints with the same wind severity are merged into one band.
 * Only gusts ≥ 35 mph (calibrated) are surfaced.
 */
export function buildWindImpacts(
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
    const frac = iv.etaMinutes / totalEtaMin;
    const startM = Math.min(totalMeters, Math.max(0, frac * totalMeters));
    const nextFrac = i + 1 < intervals.length ? intervals[i + 1]!.etaMinutes / totalEtaMin : 1;
    const endM = Math.min(totalMeters, nextFrac * totalMeters);
    if (windSeverity(iv.windGustMph) === null) continue;
    slices.push({ iv, startM, endM });
  }
  if (!slices.length) return [];

  // Merge consecutive slices with the same severity band (gap tolerance: 5 km).
  type Band = { slices: WindSlice[]; sev: RouteImpactSeverity };
  const bands: Band[] = [];
  for (const slice of slices) {
    const sev = windSeverity(slice.iv.windGustMph)!;
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
    const startM = first.startM;
    const endM = last.endM;
    const midM = (startM + endM) / 2;
    const rep = band.slices.reduce((b, s) => (s.iv.windGustMph > b.iv.windGustMph ? s : b));
    const lngLat = pointAtAlongMeters(geometry, midM);
    const spanFrac = totalMeters > 0 ? (endM - startM) / totalMeters : 0;
    const headline = windHeadline(rep.iv.windGustMph, rep.iv.windSpeedMph);
    const detail =
      spanFrac >= 0.25 && (band.sev === "serious" || band.sev === "avoid")
        ? `${headline} · ~${Math.round(spanFrac * 100)}% of route`
        : headline;

    return {
      id: `wind-${i}-${Math.round(startM)}`,
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
