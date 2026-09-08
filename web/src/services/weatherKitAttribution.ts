/**
 * WeatherKit attribution (Guideline 5.2.5) — Apple Weather trademark + legal source link.
 * REST: GET /api/v1/attribution/{language}
 * @see https://developer.apple.com/weatherkit/get-started/
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { fetchWithTimeout } from "../utils/fetchResilient";
import { fetchWeatherKitToken } from "./weatherKitAuth";

export type WeatherKitAttribution = {
  serviceName: string;
  legalPageURL: string;
  squareMarkURL: string;
  combinedMarkDarkURL: string;
  combinedMarkLightURL: string;
  legalAttributionText?: string;
};

/** Published fallbacks if the attribution endpoint is unreachable (still show trademark + link). */
export const WEATHERKIT_ATTRIBUTION_FALLBACK: WeatherKitAttribution = {
  serviceName: "Apple Weather",
  legalPageURL: "https://weatherkit.apple.com/legal-attribution.html",
  squareMarkURL: "",
  combinedMarkDarkURL: "",
  combinedMarkLightURL: "",
  legalAttributionText:
    "Weather data provided by Apple Weather. Additional attributions: https://weatherkit.apple.com/legal-attribution.html",
};

function resolveAttributionBaseUrl(): string {
  if (import.meta.env.DEV) return "/weatherkit-api/api/v1/attribution";
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.protocol === "http:"
  ) {
    return "/weatherkit-api/api/v1/attribution";
  }
  return "https://weatherkit.apple.com/api/v1/attribution";
}

const TIMEOUT_MS = 10_000;
let cached: WeatherKitAttribution | null = null;
let inflight: Promise<WeatherKitAttribution> | null = null;

export function resetWeatherKitAttributionCache(): void {
  cached = null;
  inflight = null;
}

function normalizeAttribution(raw: Partial<WeatherKitAttribution>): WeatherKitAttribution {
  return {
    serviceName: String(raw.serviceName || WEATHERKIT_ATTRIBUTION_FALLBACK.serviceName),
    legalPageURL: String(raw.legalPageURL || WEATHERKIT_ATTRIBUTION_FALLBACK.legalPageURL),
    squareMarkURL: String(raw.squareMarkURL || ""),
    combinedMarkDarkURL: String(raw.combinedMarkDarkURL || ""),
    combinedMarkLightURL: String(raw.combinedMarkLightURL || ""),
    legalAttributionText: raw.legalAttributionText
      ? String(raw.legalAttributionText)
      : WEATHERKIT_ATTRIBUTION_FALLBACK.legalAttributionText,
  };
}

/**
 * Prefer dark mark on light UI and light mark on dark UI (Apple guidance).
 */
export function weatherKitMarkUrlForTheme(
  attr: WeatherKitAttribution,
  theme: "light" | "dark"
): string {
  if (theme === "dark") {
    return attr.combinedMarkLightURL || attr.combinedMarkDarkURL || attr.squareMarkURL || "";
  }
  return attr.combinedMarkDarkURL || attr.combinedMarkLightURL || attr.squareMarkURL || "";
}

async function requestAttributionJson(url: string, token: string, signal?: AbortSignal): Promise<unknown> {
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  if (Capacitor.isNativePlatform()) {
    try {
      const hr = await CapacitorHttp.request({
        url,
        method: "GET",
        headers: authHeaders,
        connectTimeout: TIMEOUT_MS,
        readTimeout: TIMEOUT_MS,
        responseType: "json",
      });
      if (hr.status < 200 || hr.status >= 300) {
        throw new Error(`WeatherKit attribution ${hr.status}`);
      }
      return hr.data;
    } catch {
      /* fall through */
    }
  }

  const res = await fetchWithTimeout({
    input: url,
    init: { headers: authHeaders },
    timeoutMs: TIMEOUT_MS,
    externalSignal: signal,
  });
  if (!res.ok) throw new Error(`WeatherKit attribution ${res.status}`);
  return res.json();
}

/** Fetch (and cache) Apple Weather attribution assets for the UI. Never throws — uses fallback. */
export async function fetchWeatherKitAttribution(
  language = "en-US",
  signal?: AbortSignal
): Promise<WeatherKitAttribution> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const token = await fetchWeatherKitToken(signal);
      const lang = encodeURIComponent(language || "en-US");
      const url = `${resolveAttributionBaseUrl()}/${lang}`;
      const data = (await requestAttributionJson(url, token, signal)) as Partial<WeatherKitAttribution>;
      cached = normalizeAttribution(data);
      return cached;
    } catch {
      cached = WEATHERKIT_ATTRIBUTION_FALLBACK;
      return cached;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
