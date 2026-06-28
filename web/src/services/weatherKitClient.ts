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

const responseCache = new Map<string, { at: number; data: WeatherKitWeatherResponse }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(lat: number, lng: number, dataSets: WeatherKitDataSet[]): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}:${dataSets.join(",")}`;
}

export async function fetchWeatherKitAtPoint(
  lat: number,
  lng: number,
  dataSets: WeatherKitDataSet[],
  signal?: AbortSignal,
  opts?: { bypassCache?: boolean; country?: string }
): Promise<WeatherKitWeatherResponse> {
  const key = cacheKey(lat, lng, dataSets);
  if (!opts?.bypassCache) {
    const hit = responseCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  } else {
    responseCache.delete(key);
  }

  const token = await fetchWeatherKitToken(signal);
  const ds = dataSets.join(",");
  // weatherAlerts requires a country query param per Apple's WeatherKit REST API spec.
  const countryParam = opts?.country ? `&country=${encodeURIComponent(opts.country)}` : "";
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
    } catch (e) {
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
  responseCache.set(key, { at: Date.now(), data });
  return data;
}
