/**
 * Open-Meteo route-forecast backstop.
 *
 * Free API, no key, CORS-open — one multi-location GET returns hourly
 * temperature / precip / wind for every sampled waypoint. Used only when
 * the primary corridor forecast (WeatherKit / Tomorrow.io) comes back
 * empty or with dead temperature slots, so the Temp/Precip lanes always
 * have real forecast data to draw (Bill, Nov 20).
 */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { RouteForecast, RouteHourlyInterval } from "./tomorrowIo";
import { dedupeRequest } from "../utils/requestDeduplication";

const BASE_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 10_000;
const MAX_WAYPOINTS = 24;
/* One in-flight dedupe slot; a corridor backstop result ages out quickly. */
const DEDUPE_TTL_MS = 30_000;

export type RouteWaypointEta = { lat: number; lng: number; etaMinutes: number };

/**
 * WMO `weather_code` → Tomorrow.io code space. Mapping into the existing
 * scheme keeps weatherCodeLabel / weatherCodeSeverity / hazard ranks working
 * unchanged — the backstop is invisible downstream.
 */
export function wmoCodeToTio(code: number): number {
  if (code === 0) return 1000; // clear
  if (code === 1) return 1100; // mainly clear
  if (code === 2) return 1101; // partly cloudy
  if (code === 3) return 1001; // overcast
  if (code === 45 || code === 48) return 2000; // fog / rime fog
  if (code >= 51 && code <= 55) return 4000; // drizzle
  if (code === 56 || code === 57) return 6000; // freezing drizzle
  if (code === 61) return 4200; // light rain
  if (code === 63) return 4001; // rain
  if (code === 65) return 4201; // heavy rain
  if (code === 66) return 6200; // light freezing rain
  if (code === 67) return 6201; // heavy freezing rain
  if (code === 71) return 5100; // light snow
  if (code === 73) return 5000; // snow
  if (code === 75) return 5101; // heavy snow
  if (code === 77) return 5000; // snow grains
  if (code === 80) return 4200; // light showers
  if (code === 81) return 4001; // showers
  if (code === 82) return 4201; // violent showers
  if (code === 85) return 5100; // light snow showers
  if (code === 86) return 5101; // heavy snow showers
  if (code >= 95) return 8000; // thunderstorm (95/96/99)
  return 1001; // unknown → cloudy beats "Unknown" conditions text
}

type OpenMeteoHourly = {
  time?: string[];
  temperature_2m?: (number | null)[];
  precipitation_probability?: (number | null)[];
  precipitation?: (number | null)[];
  weather_code?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
};

type OpenMeteoLocation = { hourly?: OpenMeteoHourly };

async function getJsonOnce(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const effectiveSignal = signal ?? controller.signal;
  try {
    if (Capacitor.isNativePlatform()) {
      /* WKWebView can CORS-block unknown hosts — CapacitorHttp goes native. */
      clearTimeout(timeoutId);
      const hr = await CapacitorHttp.request({
        url,
        method: "GET",
        connectTimeout: TIMEOUT_MS,
        readTimeout: TIMEOUT_MS,
      });
      if (hr.status < 200 || hr.status >= 300) {
        throw new Error(`Open-Meteo ${hr.status}`);
      }
      return typeof hr.data === "string" ? JSON.parse(hr.data) : hr.data;
    }
    const res = await fetch(url, {
      headers: { "Accept-Encoding": "gzip" },
      signal: effectiveSignal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Open-Meteo ${res.status}: ${text.slice(0, 160)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Nearest hourly index to `targetMs` in an Open-Meteo `time` array (UTC ISO "…T14:00"). */
function nearestHourIndex(times: string[], targetMs: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const ms = Date.parse(`${times[i]}:00Z`);
    if (!Number.isFinite(ms)) continue;
    const d = Math.abs(ms - targetMs);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const num = (v: number | null | undefined): number =>
  v != null && Number.isFinite(v) ? v : Number.NaN;

/**
 * Hourly corridor forecast for `waypoints` (same shape the TIO/WeatherKit
 * fetch uses). One HTTP request — Open-Meteo accepts comma-separated
 * lat/lng lists and returns one forecast object per location.
 */
export async function fetchOpenMeteoRouteForecast(
  waypoints: RouteWaypointEta[],
  signal?: AbortSignal
): Promise<RouteForecast | null> {
  const pts = waypoints.slice(0, MAX_WAYPOINTS);
  if (!pts.length) return null;
  const lats = pts.map((p) => p.lat.toFixed(3)).join(",");
  const lngs = pts.map((p) => p.lng.toFixed(3)).join(",");
  const url =
    `${BASE_URL}?latitude=${lats}&longitude=${lngs}` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=mm&timezone=GMT&forecast_days=8`;

  const data = (await dedupeRequest(
    `openmeteo-route:${lats}:${lngs}`,
    () => getJsonOnce(url, signal),
    DEDUPE_TTL_MS
  )) as OpenMeteoLocation | OpenMeteoLocation[];

  const list = Array.isArray(data) ? data : [data];
  const fetchedAt = Date.now();
  const intervals: RouteHourlyInterval[] = [];
  for (let i = 0; i < pts.length; i++) {
    const hourly = list[i]?.hourly;
    const times = hourly?.time;
    if (!hourly || !times?.length) continue;
    const idx = nearestHourIndex(times, fetchedAt + pts[i]!.etaMinutes * 60_000);
    if (idx < 0) continue;
    const wmo = hourly.weather_code?.[idx];
    intervals.push({
      etaMinutes: pts[i]!.etaMinutes,
      lat: pts[i]!.lat,
      lng: pts[i]!.lng,
      tempF: num(hourly.temperature_2m?.[idx]),
      /* Hourly `precipitation` is mm accumulated in the hour — mm/h ≈ rate. */
      precipIntensityMmh: num(hourly.precipitation?.[idx]),
      precipProbability: num(hourly.precipitation_probability?.[idx]) / 100,
      windSpeedMph: num(hourly.wind_speed_10m?.[idx]),
      windGustMph: num(hourly.wind_gusts_10m?.[idx]),
      weatherCode: wmo != null && Number.isFinite(wmo) ? wmoCodeToTio(wmo) : 1001,
      wetRoadMm: 0,
    });
  }
  if (!intervals.length) return null;
  return { fetchedAt, intervals, openMeteoIntervals: intervals.length };
}

/**
 * True when the primary corridor forecast can't feed the graph lanes:
 * no intervals at all, or so many dead temp slots that the Temp lane has
 * nothing real left after the nearest-neighbor repair.
 */
export function routeForecastNeedsBackstop(forecast: RouteForecast | null): boolean {
  if (!forecast?.intervals.length) return true;
  const deadTemps = forecast.intervals.filter((iv) => !Number.isFinite(iv.tempF)).length;
  return deadTemps * 2 >= forecast.intervals.length;
}

function nearestOpenMeteoInterval(
  om: RouteForecast,
  etaMinutes: number
): RouteHourlyInterval | null {
  let best: RouteHourlyInterval | null = null;
  let bestD = Infinity;
  for (const iv of om.intervals) {
    const d = Math.abs(iv.etaMinutes - etaMinutes);
    if (d < bestD) {
      bestD = d;
      best = iv;
    }
  }
  return best;
}

/**
 * Fill dead slots on the primary forecast from the Open-Meteo corridor —
 * only non-finite fields are touched; real primary values always win.
 */
export function mergeOpenMeteoIntoRouteForecast(
  primary: RouteForecast,
  om: RouteForecast
): RouteForecast {
  let filled = 0;
  const intervals = primary.intervals.map((iv) => {
    const src = nearestOpenMeteoInterval(om, iv.etaMinutes);
    if (!src) return iv;
    const next = { ...iv };
    let touched = false;
    if (!Number.isFinite(next.tempF) && Number.isFinite(src.tempF)) {
      next.tempF = src.tempF;
      touched = true;
    }
    if (
      !Number.isFinite(next.feelsLikeF) &&
      next.feelsLikeF != null &&
      Number.isFinite(src.tempF)
    ) {
      next.feelsLikeF = src.tempF;
      touched = true;
    }
    if (!Number.isFinite(next.precipIntensityMmh) && Number.isFinite(src.precipIntensityMmh)) {
      next.precipIntensityMmh = src.precipIntensityMmh;
      touched = true;
    }
    if (!Number.isFinite(next.precipProbability) && Number.isFinite(src.precipProbability)) {
      next.precipProbability = src.precipProbability;
      touched = true;
    }
    if (!Number.isFinite(next.windSpeedMph) && Number.isFinite(src.windSpeedMph)) {
      next.windSpeedMph = src.windSpeedMph;
      touched = true;
    }
    if (!Number.isFinite(next.windGustMph) && Number.isFinite(src.windGustMph)) {
      next.windGustMph = src.windGustMph;
      touched = true;
    }
    if (!Number.isFinite(next.weatherCode)) {
      next.weatherCode = src.weatherCode;
      touched = true;
    }
    if (touched) filled++;
    return next;
  });
  return {
    ...primary,
    intervals,
    openMeteoIntervals: (primary.openMeteoIntervals ?? 0) + filled,
  };
}
