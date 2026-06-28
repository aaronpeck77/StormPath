import type { RouteHourlyInterval } from "../services/tomorrowIo";
import { weatherCodeLabel } from "../services/tomorrowIo";

const FREEZING_TEMP_F = 32;
/** Show feels-like when it differs meaningfully from air temp. */
const FEELS_LIKE_DELTA_F = 4;
/** WeatherKit visibility is meters; ~1 mi. */
const LOW_VISIBILITY_M = 1609;
const VERY_LOW_VISIBILITY_M = 402;

const WINTER_PRECIP_CODES = new Set([
  4000, 4001, 4200, 4201, 6000, 6001, 6200, 6201,
]);

/** Driver-facing headline — stronger wording for winter hazards. */
export function corridorWeatherHeadline(code: number): string {
  const label = weatherCodeLabel(code);
  switch (code) {
    case 6001:
      return "Freezing rain — icy roads likely";
    case 6201:
      return "Heavy freezing rain — dangerous ice";
    case 6000:
      return "Freezing drizzle — slippery roads";
    case 6200:
      return "Light freezing rain — watch for ice";
    case 5101:
      return "Heavy snow — reduced traction";
    case 7000:
    case 7101:
    case 7102:
      return label.includes("ice") ? `${label} — slick roads` : label;
    default:
      return label;
  }
}

export function formatCorridorTempLine(iv: RouteHourlyInterval): string {
  const air = Math.round(iv.tempF);
  const feels = iv.feelsLikeF != null ? Math.round(iv.feelsLikeF) : null;
  if (feels != null && Math.abs(feels - air) >= FEELS_LIKE_DELTA_F) {
    return `${air}°F · Feels ${feels}°F`;
  }
  return `${air}°F`;
}

/** Wet pavement at or below freezing — black ice / refreeze risk. */
export function corridorMayFreezeOnRoad(iv: RouteHourlyInterval): boolean {
  if (iv.tempF > FREEZING_TEMP_F) return false;
  return (
    iv.wetRoadMm >= 0.8 ||
    iv.precipIntensityMmh > 0.02 ||
    iv.precipProbability >= 0.15 ||
    WINTER_PRECIP_CODES.has(iv.weatherCode)
  );
}

export function formatCorridorRoadSurfaceNote(iv: RouteHourlyInterval): string | null {
  if (corridorMayFreezeOnRoad(iv)) {
    return iv.tempF <= 28 ? "Icy roads likely" : "Wet roads — may freeze";
  }
  if (iv.wetRoadMm >= 1.5) return "wet roads";
  return null;
}

export function formatCorridorVisibilityNote(iv: RouteHourlyInterval): string | null {
  const vis = iv.visibilityM;
  if (vis == null || vis >= LOW_VISIBILITY_M) return null;
  if (vis < VERY_LOW_VISIBILITY_M) return "Very low visibility";
  return "Low visibility";
}

export function formatCorridorIntervalDetail(iv: RouteHourlyInterval): string {
  const parts: string[] = [];
  if (iv.precipIntensityMmh >= 0.4) {
    parts.push(`${iv.precipIntensityMmh.toFixed(1)} mm/hr rain`);
  }
  if (iv.windGustMph >= 22) {
    parts.push(`gusts ${Math.round(iv.windGustMph)} mph`);
  }
  const road = formatCorridorRoadSurfaceNote(iv);
  if (road) parts.push(road);
  else if (iv.wetRoadMm >= 1.5) parts.push("wet roads");
  const vis = formatCorridorVisibilityNote(iv);
  if (vis) parts.push(vis);
  parts.push(formatCorridorTempLine(iv));
  return parts.join(" · ");
}

export function corridorFreezingInterval(
  forecast: { intervals: RouteHourlyInterval[] }
): { etaMinutes: number; headline: string; detail: string } | null {
  let best: RouteHourlyInterval | null = null;
  for (const iv of forecast.intervals) {
    if (!corridorMayFreezeOnRoad(iv)) continue;
    if (
      !best ||
      iv.wetRoadMm > best.wetRoadMm ||
      iv.precipIntensityMmh > best.precipIntensityMmh
    ) {
      best = iv;
    }
  }
  if (!best) return null;
  const note = formatCorridorRoadSurfaceNote(best)!;
  return {
    etaMinutes: Math.round(best.etaMinutes),
    headline: note,
    detail: formatCorridorIntervalDetail(best),
  };
}

export function corridorColdestInterval(
  forecast: { intervals: RouteHourlyInterval[] }
): { etaMinutes: number; feelsLikeF: number; tempF: number } | null {
  let best: RouteHourlyInterval | null = null;
  let coldest = Number.POSITIVE_INFINITY;
  for (const iv of forecast.intervals) {
    const feels = iv.feelsLikeF ?? iv.tempF;
    if (feels < coldest) {
      coldest = feels;
      best = iv;
    }
  }
  if (!best || coldest >= 35) return null;
  const air = Math.round(best.tempF);
  const feels = Math.round(best.feelsLikeF ?? best.tempF);
  if (feels >= air - FEELS_LIKE_DELTA_F && air >= 35) return null;
  return {
    etaMinutes: Math.round(best.etaMinutes),
    feelsLikeF: feels,
    tempF: air,
  };
}

export function corridorLowVisibilityInterval(
  forecast: { intervals: RouteHourlyInterval[] }
): { etaMinutes: number; headline: string; detail: string } | null {
  let best: RouteHourlyInterval | null = null;
  let lowestVis = Number.POSITIVE_INFINITY;
  for (const iv of forecast.intervals) {
    const vis = iv.visibilityM;
    if (vis == null || vis >= LOW_VISIBILITY_M) continue;
    if (vis < lowestVis) {
      lowestVis = vis;
      best = iv;
    }
  }
  if (!best) return null;
  const headline = formatCorridorVisibilityNote(best)!;
  return {
    etaMinutes: Math.round(best.etaMinutes),
    headline,
    detail: formatCorridorIntervalDetail(best),
  };
}
