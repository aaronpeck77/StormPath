/**
 * Converts a Tomorrow.io RouteForecast into RouteImpact[] that can be merged
 * into the existing hazard timeline.
 *
 * Strategy: consecutive waypoints with the same severity are merged into a
 * single band. Only caution-or-worse bands are emitted (clear weather → skip).
 */

import type { RouteForecast, RouteHourlyInterval } from "../services/tomorrowIo";
import { weatherCodeLabel, weatherCodeSeverity } from "../services/tomorrowIo";
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
  if (iv.windGustMph >= 45) return "wind";
  if (iv.wetRoadMm >= 2) return "flooding";
  return "weather";
}

function detailFromInterval(iv: RouteHourlyInterval): string {
  const parts: string[] = [weatherCodeLabel(iv.weatherCode)];
  if (iv.precipIntensityMmh > 0) {
    const mm = iv.precipIntensityMmh.toFixed(1);
    parts.push(`precip ${mm} mm/hr`);
  }
  if (iv.windGustMph >= 20) parts.push(`gusts ${Math.round(iv.windGustMph)} mph`);
  if (iv.wetRoadMm >= 1) parts.push(`standing water ${iv.wetRoadMm.toFixed(1)} mm`);
  parts.push(`${Math.round(iv.tempF)}°F`);
  return parts.join(" · ");
}

function headlineFromInterval(iv: RouteHourlyInterval): string {
  const label = weatherCodeLabel(iv.weatherCode);
  const sev = weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windGustMph);
  if (sev === "avoid" || sev === "serious") return `Hazardous: ${label}`;
  if (sev === "caution") return label;
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
  const longBand = spanFrac >= 0.32;
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
    // Include caution-or-worse segments and any measurable rain.
    .filter((a) => a.sev !== "info" || a.iv.precipIntensityMmh > 0.05);

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
        band.length > 1 && spanFrac >= 0.25
          ? `${forecastHeadlineForBand(rep.iv, worstSev, spanFrac)} · ${Math.round(spanFrac * 100)}% of trip`
          : detailFromInterval(rep.iv),
      numericSeverity: SEVERITY_TO_NUMERIC[worstSev],
    };
  });

  return impacts;
}
