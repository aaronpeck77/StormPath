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

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  calibratedWindGustMph,
} from "../nav/windForecastCalib";
import { pointAtAlongMeters, polylineLengthMeters, subsamplePolylineVertexBudget } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
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

/** “Right now” snapshot from the first minute of a minute-precip timeline (°F, mph). */
export type MinutePrecipNowSnapshot = {
  tempF: number;
  windMph: number;
  conditions: string;
};

/** One hour in a point (local) hourly outlook. */
export type PointHourlyInterval = {
  timeIso: string;
  /** Hours from fetch (0 = current hour). */
  offsetHours: number;
  tempF: number;
  precipIntensityMmh: number;
  precipProbability: number;
  windMph: number;
  conditions: string;
};

/** 24-hour hourly outlook at the user's position. */
export type PointHourlyForecast = {
  fetchedAt: number;
  lat: number;
  lng: number;
  hours: PointHourlyInterval[];
  provider: "tomorrowIo" | "openWeather" | "weatherKit";
};

/** One day in a multi-day local outlook. */
export type PointDailyDay = {
  dateIso: string;
  /** Short label e.g. "Wed" */
  dayLabel: string;
  highF: number;
  lowF: number;
  /** 0–1 */
  precipChance: number;
  conditions: string;
};

/** Multi-day outlook at the user's position (WeatherKit forecastDaily). */
export type PointDailyForecast = {
  fetchedAt: number;
  lat: number;
  lng: number;
  days: PointDailyDay[];
  provider: "weatherKit";
};

/** 60-minute precipitation outlook for a point. */
export type MinutePrecipForecast = {
  fetchedAt: number; // Date.now()
  lat: number;
  lng: number;
  minutes: MinutePrecipInterval[];
  /** Present when temperature / wind were requested (fallback when OpenWeather is unset). */
  now?: MinutePrecipNowSnapshot;
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
  /** Tomorrow.io lightning flash rate density (optional). */
  lightningFlashRate?: number;
  /** Hail probability 0–1 (optional). */
  hailProbability?: number;
  /** Hail size mm (optional). */
  hailSizeMm?: number;
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
    let status: number;
    let data: unknown;

    if (Capacitor.isNativePlatform()) {
      /* On iOS/Android the WKWebView CORS policy blocks direct calls to api.tomorrow.io.
       * CapacitorHttp makes native-level requests that bypass WebView CORS entirely. */
      clearTimeout(timeoutId);
      const hr = await CapacitorHttp.request({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        data: body,
        connectTimeout: TIMEOUT_MS,
        readTimeout: TIMEOUT_MS,
      });
      status = hr.status;
      data = hr.data;
    } else {
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
      status = res.status;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Tomorrow.io ${res.status}: ${text.slice(0, 200)}`);
      }
      data = await res.json();
    }

    if (status === 429) {
      noteTomorrowIoRateLimit();
      throw new Error("Tomorrow.io 429");
    }
    if (status < 200 || status >= 300) {
      throw new Error(`Tomorrow.io ${status}`);
    }
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

function postTimelines(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  bypassCache = false
): Promise<unknown> {
  return enqueueTomorrowIoPost(
    apiKey,
    body,
    (sig) => postTimelinesOnce(apiKey, body, sig ?? signal),
    signal,
    bypassCache ? { bypassCache: true } : undefined
  );
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

/** True when corridor Timelines forecast shows rain or elevated hazard (for advisory gating). */
export function routeForecastHasSignificantWeather(
  forecast: RouteForecast | null | undefined
): boolean {
  if (!forecast?.intervals.length) return false;
  return forecast.intervals.some((iv) => {
    if (iv.precipIntensityMmh > 0.05 || iv.precipProbability > 0.4) return true;
    return weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windGustMph) !== "info";
  });
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
      fields: [
        "precipitationIntensity",
        "precipitationProbability",
        "precipitationType",
        "temperature",
        "windSpeed",
        "weatherCode",
      ],
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
            temperature?: number;
            windSpeed?: number;
            weatherCode?: number;
          };
        }>;
      }>;
    };
  };

  const intervals = raw.data.timelines[0]?.intervals ?? [];
  const first = intervals[0]?.values;
  const tempC = first?.temperature;
  const windMs = first?.windSpeed;
  const now =
    tempC != null && Number.isFinite(tempC)
      ? {
          tempF: Math.round((tempC * 9) / 5 + 32),
          windMph: Math.round((windMs ?? 0) * 2.23694),
          conditions: weatherCodeLabel(first?.weatherCode ?? 1000),
        }
      : undefined;
  return {
    fetchedAt: Date.now(),
    lat,
    lng,
    now,
    minutes: intervals.map((iv) => ({
      timeIso: iv.startTime,
      precipIntensityMmh: iv.values.precipitationIntensity ?? 0,
      precipProbability: (iv.values.precipitationProbability ?? 0) / 100,
      precipType: iv.values.precipitationType ?? 0,
    })),
  };
}

// ── Point hourly (24 h local) ────────────────────────────────────────────────

/**
 * Hourly conditions at the user's position for the next 24 hours (local forecast card).
 */
export async function fetchPointHourlyForecast(
  apiKey: string,
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<PointHourlyForecast> {
  const raw = await postTimelines(
    apiKey,
    {
      location: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      fields: [
        "temperature",
        "precipitationIntensity",
        "precipitationProbability",
        "windSpeed",
        "weatherCode",
      ],
      units: "metric",
      timesteps: ["1h"],
      startTime: "now",
      endTime: "nowPlus24h",
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
            weatherCode?: number;
          };
        }>;
      }>;
    };
  };

  const fetchedAt = Date.now();
  const intervals = raw.data.timelines[0]?.intervals ?? [];
  const hours: PointHourlyInterval[] = intervals.slice(0, 24).map((iv) => {
    const tempC = iv.values.temperature ?? 0;
    const windMs = iv.values.windSpeed ?? 0;
    const code = iv.values.weatherCode ?? 1000;
    const offsetHours = (new Date(iv.startTime).getTime() - fetchedAt) / 3_600_000;
    return {
      timeIso: iv.startTime,
      offsetHours,
      tempF: Math.round((tempC * 9) / 5 + 32),
      precipIntensityMmh: iv.values.precipitationIntensity ?? 0,
      precipProbability: (iv.values.precipitationProbability ?? 0) / 100,
      windMph: Math.round(windMs * 2.23694),
      conditions: weatherCodeLabel(code),
    };
  });

  return { fetchedAt, lat, lng, hours, provider: "tomorrowIo" };
}

// ── Route hourly forecast ─────────────────────────────────────────────────────

export const TIO_ROUTE_FORECAST_MAX_LOCATIONS = 6;
/** Tomorrow.io polyline max length (m). */
const TIO_POLYLINE_MAX_M = 70_000;
const TIO_POLYLINE_MAX_VERTICES = 120;

const ROUTE_FORECAST_FIELDS = [
  "temperature",
  "precipitationIntensity",
  "precipitationProbability",
  "windSpeed",
  "windGust",
  "weatherCode",
  "wetRoadIndex",
  "lightningFlashRateDensity",
  "hailProbability",
  "hailSize",
] as const;

type TimelineValues = {
  temperature?: number;
  precipitationIntensity?: number;
  precipitationProbability?: number;
  windSpeed?: number;
  windGust?: number;
  weatherCode?: number;
  wetRoadIndex?: number;
  lightningFlashRateDensity?: number;
  hailProbability?: number;
  hailSize?: number;
};

type HourlyByOffset = { offsetMin: number; values: TimelineValues };

/** ~110 m grid — dedupe nearby waypoints without merging distinct corridor cells. */
export function routeForecastLocationKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** Spread fetch points along the route; cap API calls while covering the full corridor. */
export function pickRouteForecastFetchLocations(
  waypoints: { lat: number; lng: number; etaMinutes: number }[],
  maxLocations = TIO_ROUTE_FORECAST_MAX_LOCATIONS
): { lat: number; lng: number }[] {
  if (!waypoints.length) return [];
  if (waypoints.length <= maxLocations) {
    const seen = new Set<string>();
    const out: { lat: number; lng: number }[] = [];
    for (const wp of waypoints) {
      const k = routeForecastLocationKey(wp.lat, wp.lng);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ lat: wp.lat, lng: wp.lng });
    }
    return out;
  }

  const indices: number[] = [];
  for (let i = 0; i < maxLocations; i++) {
    indices.push(Math.round((i * (waypoints.length - 1)) / Math.max(1, maxLocations - 1)));
  }
  const seen = new Set<string>();
  const out: { lat: number; lng: number }[] = [];
  for (const i of indices) {
    const wp = waypoints[i]!;
    const k = routeForecastLocationKey(wp.lat, wp.lng);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ lat: wp.lat, lng: wp.lng });
  }
  return out;
}

function nearestFetchLocationKey(
  wp: { lat: number; lng: number },
  locations: { lat: number; lng: number }[]
): string {
  let best = locations[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const loc of locations) {
    const dLat = wp.lat - loc.lat;
    const dLng = wp.lng - loc.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = loc;
    }
  }
  return routeForecastLocationKey(best.lat, best.lng);
}

function intervalFromHourlyTimeline(
  wp: { lat: number; lng: number; etaMinutes: number },
  hourlyByOffsetMin: HourlyByOffset[]
): RouteHourlyInterval {
  let best = hourlyByOffsetMin[0]!;
  let bestDelta = Math.abs(best.offsetMin - wp.etaMinutes);
  for (const h of hourlyByOffsetMin) {
    const d = Math.abs(h.offsetMin - wp.etaMinutes);
    if (d < bestDelta) {
      bestDelta = d;
      best = h;
    }
  }
  const v = best.values;
  const tempC = v.temperature ?? 0;
  const windMs = v.windSpeed ?? 0;
  const gustMs = v.windGust ?? 0;
  const windSpeedMph = windMs * 2.23694;
  const rawGustMph = gustMs > 0 ? gustMs * 2.23694 : windSpeedMph;
  return {
    etaMinutes: wp.etaMinutes,
    lat: wp.lat,
    lng: wp.lng,
    tempF: tempC * 9 / 5 + 32,
    precipIntensityMmh: v.precipitationIntensity ?? 0,
    precipProbability: (v.precipitationProbability ?? 0) / 100,
    windSpeedMph,
    windGustMph: calibratedWindGustMph(windSpeedMph, rawGustMph),
    weatherCode: v.weatherCode ?? 1000,
    wetRoadMm: v.wetRoadIndex ?? 0,
    lightningFlashRate: v.lightningFlashRateDensity,
    hailProbability:
      v.hailProbability != null ? v.hailProbability / 100 : undefined,
    hailSizeMm: v.hailSize,
  };
}

async function fetchHourlyTimelineAtLocation(
  apiKey: string,
  lat: number,
  lng: number,
  endHours: number,
  signal?: AbortSignal,
  bypassCache = false
): Promise<HourlyByOffset[]> {
  const raw = await postTimelines(
    apiKey,
    {
      location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
      fields: [...ROUTE_FORECAST_FIELDS],
      units: "metric",
      timesteps: ["1h"],
      startTime: "now",
      endTime: `nowPlus${endHours}h`,
    },
    signal,
    bypassCache
  ) as {
    data: {
      timelines: Array<{
        intervals: Array<{
          startTime: string;
          values: TimelineValues;
        }>;
      }>;
    };
  };

  const hourlyIntervals = raw.data.timelines[0]?.intervals ?? [];
  const now = Date.now();
  return hourlyIntervals.map((iv) => ({
    offsetMin: (new Date(iv.startTime).getTime() - now) / 60_000,
    values: iv.values,
  }));
}

function simplifyPolylineForTio(geometry: LngLat[]): LngLat[] {
  if (geometry.length <= TIO_POLYLINE_MAX_VERTICES) return geometry;
  return subsamplePolylineVertexBudget(geometry, TIO_POLYLINE_MAX_VERTICES);
}

async function fetchPolylineHourlyTimeline(
  apiKey: string,
  geometry: LngLat[],
  endHours: number,
  signal?: AbortSignal,
  bypassCache = false
): Promise<HourlyByOffset[]> {
  const simplified = simplifyPolylineForTio(geometry);
  const coordinates = simplified.map(([lng, lat]) => [lng, lat]);
  const raw = await postTimelines(
    apiKey,
    {
      location: { type: "LineString", coordinates },
      fields: [...ROUTE_FORECAST_FIELDS],
      units: "metric",
      timesteps: ["1h"],
      startTime: "now",
      endTime: `nowPlus${endHours}h`,
    },
    signal,
    bypassCache
  ) as {
    data: {
      timelines: Array<{
        intervals: Array<{
          startTime: string;
          values: TimelineValues;
        }>;
      }>;
    };
  };
  const hourlyIntervals = raw.data.timelines[0]?.intervals ?? [];
  const now = Date.now();
  return hourlyIntervals.map((iv) => ({
    offsetMin: (new Date(iv.startTime).getTime() - now) / 60_000,
    values: iv.values,
  }));
}

async function fetchRouteForecastPolyline(
  apiKey: string,
  geometry: LngLat[],
  waypoints: { lat: number; lng: number; etaMinutes: number }[],
  endHours: number,
  signal?: AbortSignal,
  bypassCache = false
): Promise<RouteForecast> {
  const hourly = await fetchPolylineHourlyTimeline(
    apiKey,
    geometry,
    endHours,
    signal,
    bypassCache
  );
  const intervals = waypoints.map((wp) => {
    if (!hourly.length) {
      return {
        etaMinutes: wp.etaMinutes,
        lat: wp.lat,
        lng: wp.lng,
        tempF: 70,
        precipIntensityMmh: 0,
        precipProbability: 0,
        windSpeedMph: 0,
        windGustMph: 0,
        weatherCode: 1000,
        wetRoadMm: 0,
      };
    }
    return intervalFromHourlyTimeline(wp, hourly);
  });
  return { fetchedAt: Date.now(), intervals };
}

/**
 * Merge Tomorrow.io convective fields (lightning / hail) from a corridor polyline into an
 * existing route forecast (e.g. from WeatherKit). One API call; does not replace temps/wind.
 */
export async function enrichRouteForecastConvective(
  apiKey: string,
  geometry: LngLat[],
  forecast: RouteForecast,
  signal?: AbortSignal
): Promise<RouteForecast> {
  if (!forecast.intervals.length || geometry.length < 2) return forecast;
  if (polylineLengthMeters(geometry) > TIO_POLYLINE_MAX_M) return forecast;
  const maxEtaMin = Math.max(...forecast.intervals.map((i) => i.etaMinutes));
  const endHours = Math.ceil(maxEtaMin / 60) + 1;
  const hourly = await fetchPolylineHourlyTimeline(apiKey, geometry, endHours, signal, true);
  if (!hourly.length) return forecast;

  const intervals = forecast.intervals.map((iv) => {
    let best = hourly[0]!;
    let bestDelta = Math.abs(best.offsetMin - iv.etaMinutes);
    for (const h of hourly) {
      const d = Math.abs(h.offsetMin - iv.etaMinutes);
      if (d < bestDelta) {
        bestDelta = d;
        best = h;
      }
    }
    const v = best.values;
    const lightning = v.lightningFlashRateDensity;
    const hailP = v.hailProbability;
    const hailSize = v.hailSize;
    if (lightning == null && hailP == null && hailSize == null) return iv;
    return {
      ...iv,
      lightningFlashRate: lightning ?? iv.lightningFlashRate,
      hailProbability:
        hailP != null ? hailP / 100 : iv.hailProbability,
      hailSizeMm: hailSize ?? iv.hailSizeMm,
      weatherCode:
        (lightning != null && lightning > 0.2) || (hailP != null && hailP > 0.25)
          ? 8000
          : iv.weatherCode,
    };
  });
  return { ...forecast, fetchedAt: Date.now(), intervals };
}

/**
 * Fetches hourly weather at each corridor location (up to
 * {@link TIO_ROUTE_FORECAST_MAX_LOCATIONS} Timelines calls), keyed to ETA at each waypoint.
 * When `geometry` is ≤ 70 km, uses a single polyline Timelines call instead.
 */
export async function fetchRouteForecast(
  apiKey: string,
  waypoints: { lat: number; lng: number; etaMinutes: number }[],
  signal?: AbortSignal,
  opts?: { bypassCache?: boolean; geometry?: LngLat[] }
): Promise<RouteForecast> {
  if (!waypoints.length) return { fetchedAt: Date.now(), intervals: [] };

  const maxEtaMin = Math.max(...waypoints.map((w) => w.etaMinutes));
  const endHours = Math.ceil(maxEtaMin / 60) + 1;

  if (
    opts?.geometry &&
    opts.geometry.length >= 2 &&
    polylineLengthMeters(opts.geometry) <= TIO_POLYLINE_MAX_M
  ) {
    return fetchRouteForecastPolyline(
      apiKey,
      opts.geometry,
      waypoints,
      endHours,
      signal,
      opts.bypassCache ?? false
    );
  }

  const fetchLocations = pickRouteForecastFetchLocations(waypoints);

  const timelinesByKey = new Map<string, HourlyByOffset[]>();
  const seenKeys = new Set<string>();
  const uniqueLocations: { lat: number; lng: number }[] = [];
  for (const loc of fetchLocations) {
    const key = routeForecastLocationKey(loc.lat, loc.lng);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueLocations.push(loc);
  }

  await Promise.all(
    uniqueLocations.map(async (loc) => {
      const key = routeForecastLocationKey(loc.lat, loc.lng);
      const hourly = await fetchHourlyTimelineAtLocation(
        apiKey,
        loc.lat,
        loc.lng,
        endHours,
        signal,
        opts?.bypassCache ?? false
      );
      timelinesByKey.set(key, hourly);
    })
  );

  const intervals: RouteHourlyInterval[] = waypoints.map((wp) => {
    const locKey = nearestFetchLocationKey(wp, fetchLocations);
    const hourly = timelinesByKey.get(locKey) ?? [];
    if (!hourly.length) {
      return {
        etaMinutes: wp.etaMinutes,
        lat: wp.lat,
        lng: wp.lng,
        tempF: 70,
        precipIntensityMmh: 0,
        precipProbability: 0,
        windSpeedMph: 0,
        windGustMph: 0,
        weatherCode: 1000,
        wetRoadMm: 0,
      };
    }
    return intervalFromHourlyTimeline(wp, hourly);
  });

  return { fetchedAt: Date.now(), intervals };
}

/** Sample spacing aligned with {@link useTomorrowRouteForecast} — avoid drifting constants. */
export const TIO_ROUTE_SAMPLE_INTERVAL_M = 12_000;
export const TIO_ROUTE_MIN_SAMPLES = 4;
export const TIO_ROUTE_MAX_SAMPLES = 12;

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
    if (iv.windSpeedMph >= 25) s = Math.max(s, 0.35);
    if (iv.windGustMph >= 35) s = Math.max(s, 0.45);
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
