/**
 * Tomorrow.io Weather API client.
 *
 * Uses the POST /v4/timelines endpoint which accepts GeoJSON polylines,
 * making it ideal for route-aware forecasting.
 *
 * Rate limits (free tier): 500 req/day, 25 req/hr, 3 req/s.
 * We stay well within this by caching aggressively and only fetching when
 * the user's location or route changes meaningfully.
 */

import type { LngLat } from "../nav/types";
import { pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";
import { enqueueTomorrowIoPost, noteTomorrowIoRateLimit } from "./tomorrowIoClient";

const BASE_URL = "https://api.tomorrow.io/v4/timelines";
const TIMEOUT_MS = 10_000;

export { isTomorrowIoRateLimited } from "./tomorrowIoClient";

// ── Types ────────────────────────────────────────────────────────────────────

/** One minute of precipitation data. */
export type MinutePrecipInterval = {
  timeIso: string;
  /** mm/hr — 0 = dry, >0.5 = light, >2.5 = moderate, >7.5 = heavy */
  precipIntensityMmh: number;
  /** 0–1 probability */
  precipProbability: number;
  /** 0=N/A 1=rain 2=snow 3=freezing rain 4=ice pellets */
  precipType: number;
};

/** 60-minute precipitation outlook for a point. */
export type MinutePrecipForecast = {
  fetchedAt: number; // Date.now()
  lat: number;
  lng: number;
  minutes: MinutePrecipInterval[];
};

/** One hourly forecast sample, tied to a route waypoint. */
export type RouteHourlyInterval = {
  /** ETA at this waypoint (minutes from now). */
  etaMinutes: number;
  lat: number;
  lng: number;
  /** °F */
  tempF: number;
  /** mm/hr */
  precipIntensityMmh: number;
  /** 0–1 */
  precipProbability: number;
  /** mph */
  windSpeedMph: number;
  /** mph */
  windGustMph: number;
  /** Tomorrow.io weatherCode integer. */
  weatherCode: number;
  /** mm of standing water on road surface (WetRoadIndex). */
  wetRoadMm: number;
};

/** Route-aware hourly forecast. */
export type RouteForecast = {
  fetchedAt: number;
  intervals: RouteHourlyInterval[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function postTimelinesOnce(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const url = `${BASE_URL}?apikey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const effectiveSignal = signal ?? controller.signal;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip",
      },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });
    clearTimeout(timeoutId);
    if (res.status === 429) {
      noteTomorrowIoRateLimit();
      throw new Error("Tomorrow.io 429");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tomorrow.io ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

function postTimelines(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  return enqueueTomorrowIoPost(apiKey, body, (sig) => postTimelinesOnce(apiKey, body, sig ?? signal), signal);
}

/** Converts Tomorrow.io weatherCode to a short human label. */
export function weatherCodeLabel(code: number): string {
  const MAP: Record<number, string> = {
    1000: "Clear", 1001: "Cloudy", 1100: "Mostly clear", 1101: "Partly cloudy",
    1102: "Mostly cloudy", 2000: "Fog", 2100: "Light fog",
    4000: "Drizzle", 4001: "Rain", 4200: "Light rain", 4201: "Heavy rain",
    5000: "Snow", 5001: "Flurries", 5100: "Light snow", 5101: "Heavy snow",
    6000: "Freezing drizzle", 6001: "Freezing rain", 6200: "Light freezing rain",
    6201: "Heavy freezing rain", 7000: "Ice pellets", 7101: "Heavy ice pellets",
    7102: "Light ice pellets", 8000: "Thunderstorm",
  };
  return MAP[code] ?? "Unknown";
}

/** Rough severity for a weather code (for hazard timeline coloring). */
export function weatherCodeSeverity(
  code: number,
  precipMmh: number,
  windMph: number
): "info" | "caution" | "serious" | "avoid" {
  if (code === 8000) return "avoid"; // thunderstorm
  if ([6001, 6201, 5101, 7000, 7101].includes(code)) return "serious"; // freezing rain, heavy snow, ice
  if (precipMmh >= 7.5 || windMph >= 45) return "serious";
  if (precipMmh >= 2.5 || windMph >= 30 || [4201, 5100, 6200, 6000].includes(code)) return "caution";
  if (precipMmh > 0 || [4000, 4200, 5000, 5001].includes(code)) return "info";
  return "info";
}

// ── Minute precipitation forecast ────────────────────────────────────────────

/**
 * Fetches a 60-minute minute-by-minute precipitation forecast at the user's
 * current location. Used for the "Next hour" precip strip.
 */
export async function fetchMinutePrecip(
  apiKey: string,
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<MinutePrecipForecast> {
  const raw = await postTimelines(
    apiKey,
    {
      location: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      fields: ["precipitationIntensity", "precipitationProbability", "precipitationType"],
      units: "metric",
      timesteps: ["1m"],
      startTime: "now",
      endTime: "nowPlus60m",
    },
    signal
  ) as {
    data: {
      timelines: Array<{
        intervals: Array<{
          startTime: string;
          values: {
            precipitationIntensity?: number;
            precipitationProbability?: number;
            precipitationType?: number;
          };
        }>;
      }>;
    };
  };

  const intervals = raw.data.timelines[0]?.intervals ?? [];
  return {
    fetchedAt: Date.now(),
    lat,
    lng,
    minutes: intervals.map((iv) => ({
      timeIso: iv.startTime,
      precipIntensityMmh: iv.values.precipitationIntensity ?? 0,
      precipProbability: (iv.values.precipitationProbability ?? 0) / 100,
      precipType: iv.values.precipitationType ?? 0,
    })),
  };
}

// ── Route hourly forecast ─────────────────────────────────────────────────────

/**
 * Fetches hourly weather conditions along a route, keyed to when you'll
 * actually arrive at each waypoint.
 *
 * @param waypoints - Array of {lat, lng, etaMinutes} sampled along the route.
 *   We group these by ETA hour and call the Timelines API for each unique hour
 *   to stay within rate limits.
 */
export async function fetchRouteForecast(
  apiKey: string,
  waypoints: { lat: number; lng: number; etaMinutes: number }[],
  signal?: AbortSignal
): Promise<RouteForecast> {
  if (!waypoints.length) return { fetchedAt: Date.now(), intervals: [] };

  // To avoid many API calls, fetch a single timeline using the route start
  // point with an hourly timestep covering the full trip duration. Then map
  // each waypoint to the forecast interval whose startTime is closest to the
  // waypoint's ETA.
  const startLat = waypoints[0]!.lat;
  const startLng = waypoints[0]!.lng;
  const maxEtaMin = Math.max(...waypoints.map((w) => w.etaMinutes));
  const endHours = Math.ceil(maxEtaMin / 60) + 1;

  const raw = await postTimelines(
    apiKey,
    {
      location: `${startLat.toFixed(5)}, ${startLng.toFixed(5)}`,
      fields: [
        "temperature",
        "precipitationIntensity",
        "precipitationProbability",
        "windSpeed",
        "windGust",
        "weatherCode",
        "wetRoadIndex",
      ],
      units: "metric",
      timesteps: ["1h"],
      startTime: "now",
      endTime: `nowPlus${endHours}h`,
    },
    signal
  ) as {
    data: {
      timelines: Array<{
        intervals: Array<{
          startTime: string;
          values: {
            temperature?: number;
            precipitationIntensity?: number;
            precipitationProbability?: number;
            windSpeed?: number;
            windGust?: number;
            weatherCode?: number;
            wetRoadIndex?: number;
          };
        }>;
      }>;
    };
  };

  const hourlyIntervals = raw.data.timelines[0]?.intervals ?? [];
  const now = Date.now();

  // Build a lookup: offset minutes from now → values
  const hourlyByOffsetMin = hourlyIntervals.map((iv) => ({
    offsetMin: (new Date(iv.startTime).getTime() - now) / 60_000,
    values: iv.values,
  }));

  const intervals: RouteHourlyInterval[] = waypoints.map((wp) => {
    // Find the hourly bucket whose start is closest to this waypoint's ETA.
    let best = hourlyByOffsetMin[0]!;
    let bestDelta = Math.abs(best.offsetMin - wp.etaMinutes);
    for (const h of hourlyByOffsetMin) {
      const d = Math.abs(h.offsetMin - wp.etaMinutes);
      if (d < bestDelta) { bestDelta = d; best = h; }
    }
    const v = best.values;
    const tempC = v.temperature ?? 0;
    const windKph = v.windSpeed ?? 0;
    const gustKph = v.windGust ?? 0;
    return {
      etaMinutes: wp.etaMinutes,
      lat: wp.lat,
      lng: wp.lng,
      tempF: tempC * 9 / 5 + 32,
      precipIntensityMmh: v.precipitationIntensity ?? 0,
      precipProbability: (v.precipitationProbability ?? 0) / 100,
      windSpeedMph: windKph * 0.621371,
      windGustMph: gustKph * 0.621371,
      weatherCode: v.weatherCode ?? 1000,
      wetRoadMm: v.wetRoadIndex ?? 0,
    };
  });

  return { fetchedAt: Date.now(), intervals };
}

/** Sample spacing aligned with {@link useTomorrowRouteForecast} — avoid drifting constants. */
export const TIO_ROUTE_SAMPLE_INTERVAL_M = 16_000;
export const TIO_ROUTE_MIN_SAMPLES = 2;
export const TIO_ROUTE_MAX_SAMPLES = 8;

/**
 * Sample points along the polyline with ETA offsets for Timelines hourly forecasts.
 * Shared by navigation hooks and fused route scoring overlays.
 */
export function buildTimelinesWaypointsForGeometry(
  geometry: LngLat[],
  speedMps: number
): { lat: number; lng: number; etaMinutes: number }[] | null {
  if (geometry.length < 2) return null;
  const totalM = polylineLengthMeters(geometry);
  if (totalM < 1000) return null;

  const count = Math.max(
    TIO_ROUTE_MIN_SAMPLES,
    Math.min(TIO_ROUTE_MAX_SAMPLES, Math.floor(totalM / TIO_ROUTE_SAMPLE_INTERVAL_M))
  );

  const spd = speedMps > 0 ? speedMps : 15;
  const pts: { lat: number; lng: number; etaMinutes: number }[] = [];
  for (let i = 0; i < count; i++) {
    const distM = count > 1 ? (totalM * i) / (count - 1) : 0;
    const pt = pointAtAlongMeters(geometry, distM);
    pts.push({ lat: pt[1]!, lng: pt[0]!, etaMinutes: distM / spd / 60 });
  }
  return pts.length ? pts : null;
}

/** Map Tomorrow.io corridor forecast → 0–1 stress compatible with fused `precipHint` / scoring. */
export function routeForecastCorridorStress(forecast: RouteForecast): number {
  let max = 0;
  for (const iv of forecast.intervals) {
    let s = Math.min(1, iv.precipIntensityMmh / 8);
    s = Math.max(s, Math.min(1, (iv.wetRoadMm ?? 0) / 18));
    if (iv.weatherCode === 8000) s = Math.max(s, 0.92);
    if ([6001, 6201].includes(iv.weatherCode)) s = Math.max(s, 0.88);
    if ([5101, 7000, 7101].includes(iv.weatherCode)) s = Math.max(s, 0.72);
    if (iv.windGustMph >= 45) s = Math.max(s, 0.52);
    else if (iv.windGustMph >= 35) s = Math.max(s, 0.3);
    max = Math.max(max, s);
  }
  return Math.min(1, max);
}

function intervalRank(iv: RouteHourlyInterval): number {
  let r = iv.precipIntensityMmh * 14 + (iv.wetRoadMm ?? 0) * 2.2 + iv.windGustMph * 0.12;
  if (iv.weatherCode === 8000) r += 55;
  if ([6001, 6201].includes(iv.weatherCode)) r += 42;
  if ([5101, 7000, 7101].includes(iv.weatherCode)) r += 28;
  return r;
}

/** Short corridor headline for fused snapshots / strip context (worst sampled interval). */
export function routeForecastCompactHeadline(forecast: RouteForecast): string {
  if (!forecast.intervals.length) return "";
  let worst = forecast.intervals[0]!;
  let rank = intervalRank(worst);
  for (const iv of forecast.intervals) {
    const rr = intervalRank(iv);
    if (rr > rank) {
      rank = rr;
      worst = iv;
    }
  }
  const parts: string[] = [];
  const lbl = weatherCodeLabel(worst.weatherCode);
  if (lbl && lbl !== "Clear" && lbl !== "Unknown") parts.push(`Forecast: ${lbl}`);
  if (worst.precipIntensityMmh >= 0.45)
    parts.push(`rain ~${worst.precipIntensityMmh.toFixed(1)} mm/h`);
  if (worst.windGustMph >= 28)
    parts.push(`gusts ~${Math.round(worst.windGustMph)} mph`);
  if ((worst.wetRoadMm ?? 0) >= 2.5) parts.push("wet-road signal");
  return parts.slice(0, 3).join(" · ");
}
