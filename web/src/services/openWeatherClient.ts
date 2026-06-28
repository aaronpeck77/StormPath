import type { LngLat } from "../nav/types";
import { formatEtaDuration } from "../ui/formatEta";
import type { PointHourlyForecast, PointHourlyInterval } from "./tomorrowIo";
import { enqueueOpenWeatherGet } from "./openWeatherPacing";

export { isOpenWeatherRateLimited } from "./openWeatherPacing";

/** Free-tier friendly: current weather at a point (lat, lon). */
export async function fetchCurrentWeatherHeadline(
  apiKey: string,
  lat: number,
  lon: number
): Promise<{ headline: string; precipHint: number }> {
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "imperial");

  const res = await enqueueOpenWeatherGet(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenWeather ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    main?: { temp?: number };
    weather?: { description?: string }[];
    clouds?: { all?: number };
    rain?: { "1h"?: number };
    snow?: { "1h"?: number };
  };
  const desc = data.weather?.[0]?.description ?? "conditions";
  const tempF =
    data.main?.temp != null && Number.isFinite(data.main.temp)
      ? Math.round(data.main.temp)
      : null;
  const clouds = (data.clouds?.all ?? 0) / 100;
  const rain = data.rain?.["1h"] ?? data.snow?.["1h"] ?? 0;
  const precipHint = Math.min(1, clouds * 0.5 + Math.min(1, rain / 5));
  const headline =
    tempF != null
      ? `${tempF}°F ${desc}; clouds ${data.clouds?.all ?? 0}%`
      : `${desc}; clouds ${data.clouds?.all ?? 0}%`;
  return { headline, precipHint };
}

/** Compact "right now" reading at a single point — drives the advisory bar's nowcast line. */
export type CurrentNowcast = {
  /** Air temperature, °F (rounded). */
  tempF: number;
  /** Apparent temperature ("feels like") from OpenWeather, °F (rounded). Combines wind chill / heat index. */
  feelsLikeF: number;
  /** Sustained wind, mph (rounded). */
  windMph: number;
  /** Wind gust, mph (rounded) — null when not reported. */
  windGustMph: number | null;
  /** Short condition description, e.g. "partly cloudy", "light rain". */
  conditions: string;
  /** Inches of liquid-equivalent precip in the last hour (rain or snow). 0 when dry. */
  precipInPerHr: number;
  /** Relative humidity, 0..100 (rounded). null when missing. */
  humidityPct: number | null;
  /** UV index 0–11+ when available (WeatherKit). */
  uvIndex?: number | null;
  /** When this snapshot was fetched (ms epoch). */
  fetchedAtMs: number;
};

/**
 * Pulls the OpenWeather "current" endpoint and projects it down to just the fields the advisory
 * bar's compact nowcast line needs. Cheap to call (single point) so we do this on a slow timer
 * (every ~10 min) regardless of whether a route is loaded.
 */
export async function fetchCurrentNowcast(
  apiKey: string,
  lat: number,
  lon: number
): Promise<CurrentNowcast> {
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "imperial");

  const res = await enqueueOpenWeatherGet(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenWeather nowcast ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    weather?: { description?: string; main?: string }[];
    main?: { temp?: number; feels_like?: number; humidity?: number };
    wind?: { speed?: number; gust?: number };
    rain?: { "1h"?: number };
    snow?: { "1h"?: number };
  };

  const tempF = Math.round(data.main?.temp ?? 0);
  /* feels_like already accounts for both wind chill (cold + wind) and heat index (hot + humidity)
   * via OpenWeather's apparent-temperature model, so we don't need to re-compute either ourselves. */
  const feelsLikeF = Math.round(data.main?.feels_like ?? data.main?.temp ?? 0);
  const windMph = Math.round(data.wind?.speed ?? 0);
  const gustRaw = data.wind?.gust;
  const windGustMph =
    gustRaw != null && Number.isFinite(gustRaw) ? Math.round(gustRaw) : null;
  /* Convert mm/hr → in/hr (OpenWeather reports rain/snow in mm regardless of `units=imperial`). */
  const rainMmHr = data.rain?.["1h"] ?? 0;
  const snowMmHr = data.snow?.["1h"] ?? 0;
  const precipInPerHr = (rainMmHr + snowMmHr) / 25.4;
  const conditions = (data.weather?.[0]?.description ?? "conditions").toLowerCase();
  const humidityPct =
    data.main?.humidity != null && Number.isFinite(data.main.humidity)
      ? Math.round(data.main.humidity)
      : null;

  return {
    tempF,
    feelsLikeF,
    windMph,
    windGustMph,
    conditions,
    precipInPerHr,
    humidityPct,
    fetchedAtMs: Date.now(),
  };
}

/**
 * Compose the compact one-line summary the advisory bar's preview banner shows.
 * Examples:
 *   "72°F · Wind 8 mph · Partly cloudy"
 *   "28°F · Feels 18°F · Wind 14 mph · Snow 0.05 in/hr"
 *   "94°F · Feels 102°F · Humid · Wind 6 mph"
 *
 * Rules:
 *   - Always lead with current temp.
 *   - Show "Feels NN°F" when |feels - temp| ≥ 4°F or when very cold (< 35°F) or very hot (≥ 90°F).
 *   - Always show wind (it's a small number; usually short).
 *   - Add precip rate when ≥ 0.01 in/hr.
 *   - Fall back to a short conditions clause when there's room.
 */
export function formatNowcastLine(now: CurrentNowcast): string {
  const parts: string[] = [];
  parts.push(`${now.tempF}\u00b0F`);

  const dt = Math.abs(now.feelsLikeF - now.tempF);
  const isCold = now.tempF < 35;
  const isHot = now.tempF >= 90;
  if (dt >= 4 || isCold || isHot) {
    parts.push(`Feels ${now.feelsLikeF}\u00b0F`);
  }

  if (now.uvIndex != null && now.uvIndex >= 6) {
    parts.push(`UV ${Math.round(now.uvIndex)}`);
  }

  if (now.windMph >= 1) {
    if (now.windGustMph != null && now.windGustMph >= now.windMph + 8) {
      parts.push(`Wind ${now.windMph} g${now.windGustMph} mph`);
    } else {
      parts.push(`Wind ${now.windMph} mph`);
    }
  }

  if (now.precipInPerHr >= 0.01) {
    /* Use 2 decimals when light, 1 when heavier, so the number always reads cleanly. */
    const fmt = now.precipInPerHr < 0.1 ? now.precipInPerHr.toFixed(2) : now.precipInPerHr.toFixed(1);
    /* Pick rain vs snow word from conditions when possible; default to "Precip". */
    const isSnow = /snow|sleet|flurr/i.test(now.conditions);
    parts.push(`${isSnow ? "Snow" : "Rain"} ${fmt} in/hr`);
  }

  /* Add a short conditions clause as the tail when nothing more important is competing. We keep
   * total banner copy short so the preview stays readable at a glance. */
  if (parts.length < 4 && now.conditions && !/conditions/.test(now.conditions)) {
    /* Capitalize first letter for visual symmetry with the rest of the parts. */
    const c = now.conditions.charAt(0).toUpperCase() + now.conditions.slice(1);
    parts.push(c);
  }

  return parts.join(" \u00b7 ");
}

/** Next 24 hours at a point (3-hour steps, 8 windows). Free tier `forecast`. */
export async function fetchOpenWeatherPointHourly24h(
  apiKey: string,
  lat: number,
  lon: number
): Promise<PointHourlyForecast> {
  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "imperial");
  url.searchParams.set("cnt", "8");

  const res = await enqueueOpenWeatherGet(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenWeather hourly ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    list?: {
      dt: number;
      dt_txt?: string;
      main?: { temp?: number };
      weather?: { description?: string }[];
      pop?: number;
      wind?: { speed?: number };
      rain?: { "3h"?: number };
      snow?: { "3h"?: number };
    }[];
  };

  const fetchedAt = Date.now();
  const hours: PointHourlyInterval[] = (data.list ?? []).slice(0, 8).map((it) => {
    const tMs = it.dt * 1000;
    const pop = it.pop ?? 0;
    const rainMm = (it.rain?.["3h"] ?? it.snow?.["3h"] ?? 0) / 3;
    return {
      timeIso: new Date(tMs).toISOString(),
      offsetHours: (tMs - fetchedAt) / 3_600_000,
      tempF: Math.round(it.main?.temp ?? 0),
      precipIntensityMmh: rainMm,
      precipProbability: pop,
      windMph: Math.round(it.wind?.speed ?? 0),
      conditions: it.weather?.[0]?.description ?? "conditions",
    };
  });

  return { fetchedAt, lat, lng: lon, hours, provider: "openWeather" };
}

/** Next ~6–9 hours at a point (3-hour steps). Free tier `forecast`. */
export async function fetchForecastWindowHeadline(
  apiKey: string,
  lat: number,
  lon: number
): Promise<string> {
  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "imperial");
  url.searchParams.set("cnt", "8");

  const res = await enqueueOpenWeatherGet(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenWeather forecast ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    list?: { dt_txt?: string; weather?: { description?: string }[]; pop?: number }[];
  };
  const items = data.list ?? [];
  if (items.length === 0) return "No forecast windows returned.";
  const bits = items.slice(0, 4).map((it) => {
    const w = it.weather?.[0]?.description ?? "conditions";
    const pop = it.pop != null ? ` ${Math.round(it.pop * 100)}% precip` : "";
    const when = it.dt_txt?.slice(5, 16) ?? "";
    return when ? `${when}: ${w}${pop}` : `${w}${pop}`;
  });
  return bits.join(" · ");
}

export type RouteWeatherPoint = {
  label: string;
  arrivalOffsetMin: number;
  tempF: number | null;
  conditions: string;
  precipPct: number;
  precipHint: number;
};

export type RouteWeatherForecast = {
  points: RouteWeatherPoint[];
  headline: string;
  precipHint: number;
};

/**
 * Forecast-style weather along a route: samples 5 points, estimates when the driver
 * will reach each point, and fetches the forecast for that future time window.
 * Falls back to current weather if forecast API fails for a point.
 */
export async function weatherForecastAlongRoute(
  apiKey: string,
  geometry: LngLat[],
  totalEtaMinutes: number
): Promise<RouteWeatherForecast> {
  if (geometry.length === 0)
    return { points: [], headline: "No route geometry", precipHint: 0 };

  const last = geometry.length - 1;
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const labels = ["Start", "Quarter", "Midway", "3/4 mark", "Destination"];

  const sampleIdxs = fractions.map((t) => Math.min(last, Math.round(t * last)));
  const uniqueIdxMap = new Map<number, number[]>();
  sampleIdxs.forEach((idx, i) => {
    const arr = uniqueIdxMap.get(idx) ?? [];
    arr.push(i);
    uniqueIdxMap.set(idx, arr);
  });

  const uniqueIdxs = [...uniqueIdxMap.keys()];
  /* One request at a time: on weak cell, parallel bursts often fail or stall. */
  const rawResults: {
    gIdx: number;
    forecast: {
      dt?: number;
      main?: { temp?: number };
      weather?: { description?: string }[];
      pop?: number;
      clouds?: { all?: number };
      rain?: { "3h"?: number };
      snow?: { "3h"?: number };
    }[];
    error: boolean;
  }[] = [];
  for (const gIdx of uniqueIdxs) {
    const [lng, lat] = geometry[gIdx]!;
    try {
      const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("appid", apiKey);
      url.searchParams.set("units", "imperial");
      url.searchParams.set("cnt", String(Math.min(40, Math.max(8, Math.ceil(totalEtaMinutes / 180) + 2))));

      const res = await enqueueOpenWeatherGet(url.toString());
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as {
        list?: {
          dt?: number;
          main?: { temp?: number };
          weather?: { description?: string }[];
          pop?: number;
          clouds?: { all?: number };
          rain?: { "3h"?: number };
          snow?: { "3h"?: number };
        }[];
      };
      rawResults.push({ gIdx, forecast: data.list ?? [], error: false });
    } catch {
      rawResults.push({ gIdx, forecast: [], error: true });
    }
  }

  const resultMap = new Map(rawResults.map((r) => [r.gIdx, r]));

  const points: RouteWeatherPoint[] = [];
  let maxPrecipHint = 0;

  for (let i = 0; i < fractions.length; i++) {
    const gIdx = sampleIdxs[i]!;
    const arrivalMin = fractions[i]! * totalEtaMinutes;
    const arrivalMs = Date.now() + arrivalMin * 60_000;
    const result = resultMap.get(gIdx);
    const fc = result?.forecast ?? [];

    let tempF: number | null = null;
    let conditions = "conditions";
    let precipPct = 0;
    let precipHint = 0;

    if (fc.length > 0) {
      type FcItem = NonNullable<typeof fc>[number];
      const best = (fc as FcItem[]).reduce((prev, cur) => {
        const prevDt = (prev as FcItem).dt ?? 0;
        const curDt = (cur as FcItem).dt ?? 0;
        return Math.abs(curDt * 1000 - arrivalMs) < Math.abs(prevDt * 1000 - arrivalMs) ? cur : prev;
      });
      tempF = (best as FcItem).main?.temp ?? null;
      conditions = (best as FcItem).weather?.[0]?.description ?? "conditions";
      precipPct = Math.round(((best as FcItem).pop ?? 0) * 100);
      const clouds = ((best as FcItem).clouds?.all ?? 0) / 100;
      const rain = (best as FcItem).rain?.["3h"] ?? (best as FcItem).snow?.["3h"] ?? 0;
      const heuristic = Math.min(1, clouds * 0.5 + Math.min(1, rain / 5));
      precipHint = Math.max(precipPct / 100, heuristic);
    } else if (!result?.error) {
      try {
        const [lng, lat] = geometry[gIdx]!;
        const cur = await fetchCurrentWeatherHeadline(apiKey, lat, lng);
        conditions = cur.headline.split(";")[0] ?? "conditions";
        precipHint = cur.precipHint;
      } catch { /* skip */ }
    }

    maxPrecipHint = Math.max(maxPrecipHint, precipHint);

    points.push({
      label: labels[i]!,
      arrivalOffsetMin: arrivalMin,
      tempF: tempF != null ? Math.round(tempF) : null,
      conditions,
      precipPct,
      precipHint,
    });
  }

  const headlineParts = points.map((p) => {
    const temp = p.tempF != null ? `${p.tempF}\u00b0F` : "";
    const offsetLabel =
      p.arrivalOffsetMin < 2
        ? ""
        : ` (in ~${formatEtaDuration(p.arrivalOffsetMin)})`;
    return `${p.label}${offsetLabel}: ${temp ? temp + " " : ""}${p.conditions}${p.precipPct > 0 ? ` ${p.precipPct}% precip` : ""}`;
  });
  const headline = headlineParts.join(" \u2192 ");

  return { points, headline, precipHint: maxPrecipHint };
}

/** Sample points along a polyline for a corridor read (batched current-weather calls). */
export async function weatherHintsAlongPolyline(
  apiKey: string,
  geometry: LngLat[]
): Promise<{ headline: string; precipHint: number }> {
  const r = await weatherHintSamplesAlongPolyline(apiKey, geometry);
  return { headline: r.headline, precipHint: r.precipHint };
}

export type WeatherHintSample = {
  /** 0..1 chord fraction along the polyline */
  t: number;
  /** 0..1 “precip hint” (clouds + recent precip heuristic) */
  precipHint: number;
  headline: string;
};

/** Sample points along a polyline and return per-sample precip hints (for bands/segments). */
export async function weatherHintSamplesAlongPolyline(
  apiKey: string,
  geometry: LngLat[]
): Promise<{ headline: string; precipHint: number; samples: WeatherHintSample[] }> {
  if (geometry.length === 0) return { headline: "No route geometry", precipHint: 0, samples: [] };
  const last = geometry.length - 1;
  const ts = [0, 0.12, 0.28, 0.5, 0.72, 0.88, 1];
  const idxs = ts.map((t) => Math.min(last, Math.round(t * last)));
  const uniqueIdxs = [...new Set(idxs)];

  const byIdx = new Map<number, { headline: string; precipHint: number }>();
  const results: { headline: string; precipHint: number }[] = [];
  for (const i of uniqueIdxs) {
    const [lng, lat] = geometry[i]!;
    try {
      const r = await fetchCurrentWeatherHeadline(apiKey, lat, lng);
      byIdx.set(i, r);
      results.push(r);
    } catch {
      const fallback = { headline: "conditions", precipHint: 0 };
      byIdx.set(i, fallback);
      results.push(fallback);
    }
  }

  const precipHint = results.reduce((m, r) => Math.max(m, r.precipHint), 0);
  const headline = results.map((r) => r.headline).join(" · ");

  const samples: WeatherHintSample[] = ts.map((t, j) => {
    const idx = idxs[j]!;
    const r = byIdx.get(idx) ?? { headline: "conditions", precipHint: 0 };
    return { t, precipHint: r.precipHint, headline: r.headline };
  });

  return { headline, precipHint, samples };
}

const ROUTE_POINT_FRACTION: Record<string, number> = {
  Start: 0,
  Quarter: 0.25,
  Midway: 0.5,
  "3/4 mark": 0.75,
  Destination: 1,
};

/** Rich samples from a along-route forecast — powers the progress info weather graph. */
export function weatherSamplesFromRoutePoints(
  points: RouteWeatherPoint[]
): WeatherHintSample[] {
  return points.map((p) => {
    const t = ROUTE_POINT_FRACTION[p.label] ?? 0.5;
    const temp = p.tempF != null ? `${p.tempF}°F ` : "";
    const precipHint = Math.max(p.precipHint, p.precipPct / 100);
    const precip =
      p.precipPct > 0
        ? ` ${p.precipPct}% precip`
        : precipHint > 0.05
          ? ` ${Math.round(precipHint * 100)}% precip`
          : "";
    return {
      t,
      precipHint,
      headline: `${temp}${p.conditions}${precip}`.trim(),
    };
  });
}
