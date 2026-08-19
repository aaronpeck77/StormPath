/**
 * Apple WeatherKit REST client (https://developer.apple.com/documentation/weatherkitrestapi).
 * Auth: Bearer JWT from {@link fetchWeatherKitToken}.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { fetchWithTimeout } from "../utils/fetchResilient";
import { fetchWeatherKitToken } from "./weatherKitAuth";

/* Apple blocks CORS preflights from browser/WebView origins.
 * Dev: Vite proxies through the dev server (server-side call, no CORS).
 * Native (Capacitor): use CapacitorHttp which makes native-level HTTP requests
 *   that bypass WKWebView CORS restrictions entirely.
 * Deployed web: same-origin Netlify proxy (not yet wired — keep for future).
 * Runtime hostname check is belt-and-suspenders for cached DEV=false modules. */
function resolveWeatherKitBaseUrl(): string {
  if (import.meta.env.DEV) return "/weatherkit-api/api/v1/weather";
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.protocol === "http:"
  ) {
    return "/weatherkit-api/api/v1/weather";
  }
  return "https://weatherkit.apple.com/api/v1/weather";
}
const BASE_URL = resolveWeatherKitBaseUrl();
const TIMEOUT_MS = 12_000;

export type WeatherKitDataSet =
  | "currentWeather"
  | "forecastHourly"
  | "forecastNextHour"
  | "forecastDaily"
  | "weatherAlerts";

export type WeatherKitConditionCode = string;

export type WeatherKitCurrentWeather = {
  asOf: string;
  cloudCover: number;
  conditionCode: WeatherKitConditionCode;
  humidity: number;
  precipitationIntensity: number;
  pressure: number;
  temperature: number;
  temperatureApparent: number;
  temperatureDewPoint: number;
  uvIndex: number;
  visibility: number;
  windDirection: number;
  windGust?: number;
  windSpeed: number;
};

export type WeatherKitHourly = {
  forecastStart: string;
  cloudCover: number;
  conditionCode: WeatherKitConditionCode;
  humidity: number;
  precipitationAmount: number;
  precipitationChance: number;
  precipitationIntensity: number;
  precipitationType: string;
  pressure: number;
  temperature: number;
  temperatureApparent: number;
  /** Horizontal visibility in meters (when provided by WeatherKit). */
  visibility?: number;
  uvIndex?: number;
  windDirection: number;
  windGust?: number;
  windSpeed: number;
};

export type WeatherKitNextHourMinute = {
  startTime: string;
  precipitationChance: number;
  precipitationIntensity: number;
  precipitationType: string;
};

export type WeatherKitWeatherResponse = {
  currentWeather?: WeatherKitCurrentWeather;
  forecastHourly?: { hours: WeatherKitHourly[] };
  forecastDaily?: { days: WeatherKitDailyDay[] };
  forecastNextHour?: { minutes: WeatherKitNextHourMinute[]; summary?: unknown[] };
  weatherAlerts?: { alerts: WeatherKitAlert[] };
};

export type WeatherKitDailyDay = {
  forecastStart: string;
  conditionCode: string;
  temperatureMax: number;
  temperatureMin: number;
  precipitationChance: number;
  precipitationAmount?: number;
  precipitationType?: string;
  maxUvIndex?: number;
  snowfallAmount?: number;
  daytimeForecast?: { conditionCode?: string; temperatureMax?: number; temperatureMin?: number };
  overnightForecast?: { conditionCode?: string; temperatureMax?: number; temperatureMin?: number };
};

export type WeatherKitAlert = {
  /** Unique alert identifier. */
  id: string;
  /** Short event name e.g. "Tornado Warning", "Orages" */
  eventOnset: string;
  eventEnd: string | null;
  /** Source agency name e.g. "National Weather Service" */
  eventSource: string;
  /** "extreme" | "severe" | "moderate" | "minor" | "unknown" */
  severity: string;
  /** "immediate" | "expected" | "future" | "past" | "unknown" */
  urgency: string;
  /** "observed" | "likely" | "possible" | "unlikely" | "unknown" */
  certainty: string;
  /** Human-readable description. */
  description: string;
  /** Link to full alert detail on the source agency site. */
  detailsUrl: string | null;
  /** ISO 8601 onset time. */
  effectiveTime: string | null;
  /** ISO 8601 expiry time. */
  expireTime: string | null;
  /** Two-letter country code. */
  countryCode: string | null;
  /** Area name e.g. "Champaign; Douglas; Edgar" */
  areaId: string | null;
  areaName: string | null;
};

/**
 * One REST call covers every puck weather hook (nowcast, minute rain, hourly/daily, alerts).
 * Corridor hourly along a route stays a single-dataset fetch so we do not 5× those points.
 */
export const WEATHERKIT_PUCK_DATASETS: WeatherKitDataSet[] = [
  "currentWeather",
  "forecastHourly",
  "forecastDaily",
  "forecastNextHour",
  "weatherAlerts",
];

/** ~110 m cell — GPS wander should not miss cache. */
export function weatherKitLocationCell(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** ~1.1 km — alerts / puck polls do not need street-level GPS. */
export function weatherKitAlertPollKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export function weatherKitUsesPuckBundle(dataSets: WeatherKitDataSet[]): boolean {
  return !(dataSets.length === 1 && dataSets[0] === "forecastHourly");
}

type CachedWeather = {
  at: number;
  data: WeatherKitWeatherResponse;
  dataSets: WeatherKitDataSet[];
};

const responseCache = new Map<string, CachedWeather>();
const inflight = new Map<string, Promise<WeatherKitWeatherResponse>>();
const PUCK_CACHE_TTL_MS = 8 * 60 * 1000;
const ROUTE_HOURLY_TTL_MS = 12 * 60 * 1000;

export function resetWeatherKitClientCaches(): void {
  responseCache.clear();
  inflight.clear();
}

function ttlMsFor(dataSets: WeatherKitDataSet[]): number {
  return weatherKitUsesPuckBundle(dataSets) ? PUCK_CACHE_TTL_MS : ROUTE_HOURLY_TTL_MS;
}

function datasetsCover(have: WeatherKitDataSet[], want: WeatherKitDataSet[]): boolean {
  return want.every((d) => have.includes(d));
}

function readFreshCache(
  cell: string,
  want: WeatherKitDataSet[]
): WeatherKitWeatherResponse | null {
  const ttl = ttlMsFor(want);
  const now = Date.now();
  for (const [key, hit] of responseCache) {
    if (!key.startsWith(`${cell}|`)) continue;
    if (now - hit.at >= ttl) continue;
    if (datasetsCover(hit.dataSets, want)) return hit.data;
  }
  return null;
}

function dropCellCache(cell: string): void {
  for (const key of [...responseCache.keys()]) {
    if (key.startsWith(`${cell}|`)) responseCache.delete(key);
  }
}

/** Coarse country for `weatherAlerts` — same boxes as the alerts adapter. */
export function weatherKitCountryCode(lat: number, lng: number): string {
  if (lat >= 24 && lat <= 72 && lng >= -180 && lng <= -65) return "US";
  if (lat >= 42 && lat <= 84 && lng >= -141 && lng <= -52) return "CA";
  if (lat >= 14 && lat <= 33 && lng >= -118 && lng <= -86) return "MX";
  if (lat >= 49 && lat <= 61 && lng >= -10 && lng <= 2) return "GB";
  if (lat >= -44 && lat <= -10 && lng >= 113 && lng <= 154) return "AU";
  if (lat >= 47 && lat <= 55 && lng >= 6 && lng <= 15) return "DE";
  if (lat >= 42 && lat <= 51 && lng >= -5 && lng <= 9) return "FR";
  return "US";
}

export async function fetchWeatherKitAtPoint(
  lat: number,
  lng: number,
  dataSets: WeatherKitDataSet[],
  signal?: AbortSignal,
  opts?: { bypassCache?: boolean; country?: string }
): Promise<WeatherKitWeatherResponse> {
  const cell = weatherKitLocationCell(lat, lng);
  const fetchSets = weatherKitUsesPuckBundle(dataSets) ? WEATHERKIT_PUCK_DATASETS : dataSets;
  const country =
    opts?.country ??
    (fetchSets.includes("weatherAlerts") ? weatherKitCountryCode(lat, lng) : undefined);
  const requestKey = `${cell}|${fetchSets.join(",")}|${country ?? ""}`;

  if (!opts?.bypassCache) {
    const hit = readFreshCache(cell, dataSets);
    if (hit) return hit;
    const pending = inflight.get(requestKey);
    if (pending) return pending;
  } else {
    dropCellCache(cell);
  }

  const pending = inflight.get(requestKey);
  if (pending && !opts?.bypassCache) return pending;

  let started!: Promise<WeatherKitWeatherResponse>;
  started = (async () => {
    const token = await fetchWeatherKitToken(signal);
    const ds = fetchSets.join(",");
    // weatherAlerts requires a country query param per Apple's WeatherKit REST API spec.
    const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
    const url = `${BASE_URL}/en-US/${lat.toFixed(4)}/${lng.toFixed(4)}?dataSets=${encodeURIComponent(ds)}${countryParam}`;
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    let res: Response;
    if (Capacitor.isNativePlatform()) {
      /* On iOS/Android the WebView CORS policy blocks direct calls to weatherkit.apple.com.
       * CapacitorHttp makes native-level requests that bypass WebView CORS entirely. */
      try {
        const hr = await CapacitorHttp.request({
          url,
          method: "GET",
          headers: authHeaders,
          connectTimeout: TIMEOUT_MS,
          readTimeout: TIMEOUT_MS,
          responseType: "json",
        });
        const body = typeof hr.data === "string" ? hr.data : JSON.stringify(hr.data ?? {});
        res = new Response(body, {
          status: hr.status,
          headers: new Headers(hr.headers as Record<string, string>),
        });
      } catch {
        /* CapacitorHttp failed — fall through to standard fetch as last resort. */
        res = await fetchWithTimeout({
          input: url,
          init: { headers: authHeaders },
          timeoutMs: TIMEOUT_MS,
          externalSignal: signal,
        });
      }
    } else {
      res = await fetchWithTimeout({
        input: url,
        init: { headers: authHeaders },
        timeoutMs: TIMEOUT_MS,
        externalSignal: signal,
      });
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`WeatherKit auth ${res.status}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`WeatherKit ${res.status}: ${text.slice(0, 160)}`);
    }

    const data = (await res.json()) as WeatherKitWeatherResponse;
    responseCache.set(requestKey, { at: Date.now(), data, dataSets: fetchSets });
    return data;
  })().finally(() => {
    if (inflight.get(requestKey) === started) inflight.delete(requestKey);
  });
  inflight.set(requestKey, started);
  return started;
}
