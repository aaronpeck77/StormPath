/**
 * Apple WeatherKit REST client (https://developer.apple.com/documentation/weatherkitrestapi).
 * Auth: Bearer JWT from {@link fetchWeatherKitToken}.
 */
import { fetchWithTimeout } from "../utils/fetchResilient";
import { fetchWeatherKitToken } from "./weatherKitAuth";

/* Apple blocks CORS preflights from localhost, so dev builds proxy through Vite.
 * Runtime hostname check is belt-and-suspenders: if the browser has a cached
 * module where import.meta.env.DEV was compiled as false (e.g. after a vite
 * preview session), we still catch localhost:5173 correctly at runtime.
 * Capacitor native uses capacitor://localhost — skip proxy there. */
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
  | "forecastNextHour";

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
  forecastNextHour?: { minutes: WeatherKitNextHourMinute[]; summary?: unknown[] };
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
  opts?: { bypassCache?: boolean }
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
  const url = `${BASE_URL}/en-US/${lat.toFixed(4)}/${lng.toFixed(4)}?dataSets=${encodeURIComponent(ds)}`;

  const res = await fetchWithTimeout({
    input: url,
    init: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
    timeoutMs: TIMEOUT_MS,
    externalSignal: signal,
  });

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
