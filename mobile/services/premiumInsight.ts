/**
 * Premium-only network calls (weather routing, hazard summary, traffic sample).
 * Prefer EXPO_PUBLIC_STORMPATH_API_BASE for weather in production so keys stay off-device.
 */

const stormpathBase =
  process.env.EXPO_PUBLIC_STORMPATH_API_BASE?.trim().replace(/\/$/, "") ?? "";
const stormpathKey = process.env.EXPO_PUBLIC_STORMPATH_API_KEY?.trim() ?? "";
const openWeatherKey =
  process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY?.trim() ?? "";

const NWS_UA =
  process.env.EXPO_PUBLIC_NWS_USER_AGENT?.trim() ||
  "StormPath-Mobile/1.0 (https://github.com/stormpath)";

export type WeatherRoutingInsight = {
  source: "stormpath" | "openweather";
  headline: string;
  /** 0–1 blend used like web `precipHint` */
  precipHint: number;
  /** 0–100, higher = more weather stress on a notional route */
  routeWeatherScore: number;
};

export type HazardGuidanceInsight = {
  activeAlertCount: number;
  headline: string;
};

export type TrafficBypassSample = {
  durationMinutes: number;
  distanceMeters: number;
  hasTrafficProfile: boolean;
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function scoreFromPrecipHint(precipHint: number): number {
  return Math.round(clamp01(precipHint) * 100);
}

/** ~3 km northeast of origin for a short traffic-aware leg */
export function sampleDestinationLngLat(
  originLng: number,
  originLat: number
): [number, number] {
  const dLng = 0.034;
  const dLat = 0.02;
  return [originLng + dLng, originLat + dLat];
}

export async function fetchWeatherRoutingInsight(
  lat: number,
  lon: number
): Promise<WeatherRoutingInsight> {
  if (stormpathBase) {
    const url = new URL(`${stormpathBase}/api/v1/weather/current`);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (stormpathKey) {
      headers.Authorization = `Bearer ${stormpathKey}`;
    }
    const res = await fetch(url.toString(), { headers });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`StormPath weather ${res.status}: ${text.slice(0, 160)}`);
    }
    let data: { headline?: string; precipHint?: number } = {};
    try {
      data = JSON.parse(text) as { headline?: string; precipHint?: number };
    } catch {
      throw new Error("StormPath weather: invalid JSON");
    }
    const headline = data.headline?.trim() || "Weather data returned.";
    const precipHint =
      typeof data.precipHint === "number" ? clamp01(data.precipHint) : 0;
    return {
      source: "stormpath",
      headline,
      precipHint,
      routeWeatherScore: scoreFromPrecipHint(precipHint),
    };
  }

  if (!openWeatherKey) {
    throw new Error(
      "Set EXPO_PUBLIC_STORMPATH_API_BASE (recommended) or EXPO_PUBLIC_OPENWEATHER_API_KEY for Weather Routing."
    );
  }

  const owUrl = new URL("https://api.openweathermap.org/data/2.5/weather");
  owUrl.searchParams.set("lat", String(lat));
  owUrl.searchParams.set("lon", String(lon));
  owUrl.searchParams.set("appid", openWeatherKey);
  owUrl.searchParams.set("units", "imperial");

  const res = await fetch(owUrl.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenWeather ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    weather?: { description?: string }[];
    clouds?: { all?: number };
    rain?: { "1h"?: number };
    snow?: { "1h"?: number };
  };
  const desc = data.weather?.[0]?.description ?? "conditions";
  const clouds = (data.clouds?.all ?? 0) / 100;
  const rain = data.rain?.["1h"] ?? data.snow?.["1h"] ?? 0;
  const precipHint = clamp01(clouds * 0.5 + Math.min(1, rain / 5));
  const headline = `${desc}; clouds ${data.clouds?.all ?? 0}%`;
  return {
    source: "openweather",
    headline,
    precipHint,
    routeWeatherScore: scoreFromPrecipHint(precipHint),
  };
}

export async function fetchHazardGuidanceInsight(
  lat: number,
  lon: number
): Promise<HazardGuidanceInsight> {
  const url = new URL("https://api.weather.gov/alerts/active");
  url.searchParams.set("point", `${lat},${lon}`);
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/geo+json",
      "User-Agent": NWS_UA,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`NWS alerts ${res.status}: ${t.slice(0, 120)}`);
  }
  const data = (await res.json()) as { features?: unknown[] };
  const activeAlertCount = data.features?.length ?? 0;
  const headline =
    activeAlertCount === 0
      ? "No active NWS alerts at map center."
      : `${activeAlertCount} active NWS alert${activeAlertCount === 1 ? "" : "s"} near map center.`;
  return { activeAlertCount, headline };
}

export async function fetchTrafficBypassSample(
  mapboxToken: string,
  originLng: number,
  originLat: number
): Promise<TrafficBypassSample> {
  const [destLng, destLat] = sampleDestinationLngLat(originLng, originLat);
  const o = `${originLng.toFixed(5)},${originLat.toFixed(5)}`;
  const d = `${destLng.toFixed(5)},${destLat.toFixed(5)}`;
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o};${d}`
  );
  url.searchParams.set("access_token", mapboxToken);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "false");

  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    code?: string;
    message?: string;
    routes?: { duration?: number; distance?: number }[];
  };
  if (!res.ok || (data.code && data.code !== "Ok")) {
    throw new Error(
      `Mapbox traffic ${res.status}: ${data.message ?? data.code ?? "unknown"}`
    );
  }
  const route = data.routes?.[0];
  const durationSec = route?.duration ?? 0;
  const distanceM = route?.distance ?? 0;
  return {
    durationMinutes: Math.max(0.1, durationSec / 60),
    distanceMeters: distanceM,
    hasTrafficProfile: true,
  };
}
