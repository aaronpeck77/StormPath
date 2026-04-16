import type { LngLat } from "../nav/types";

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

  const res = await fetch(url.toString());
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
  const precipHint = Math.min(1, clouds * 0.5 + Math.min(1, rain / 5));
  const headline = `${desc}; clouds ${data.clouds?.all ?? 0}%`;
  return { headline, precipHint };
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

  const res = await fetch(url.toString());
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
  const rawResults = await Promise.all(
    uniqueIdxs.map(async (gIdx) => {
      const [lng, lat] = geometry[gIdx]!;
      try {
        const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
        url.searchParams.set("lat", String(lat));
        url.searchParams.set("lon", String(lng));
        url.searchParams.set("appid", apiKey);
        url.searchParams.set("units", "imperial");
        url.searchParams.set("cnt", "8");

        const res = await fetch(url.toString());
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
        return { gIdx, forecast: data.list ?? [], error: false };
      } catch {
        return { gIdx, forecast: [] as typeof Array.prototype, error: true };
      }
    })
  );

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
      precipHint = Math.min(1, clouds * 0.5 + Math.min(1, rain / 5));
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
        : p.arrivalOffsetMin < 60
          ? ` (in ~${Math.round(p.arrivalOffsetMin)} min)`
          : ` (in ~${(p.arrivalOffsetMin / 60).toFixed(1)} hr)`;
    return `${p.label}${offsetLabel}: ${temp ? temp + " " : ""}${p.conditions}${p.precipPct > 10 ? ` ${p.precipPct}% precip` : ""}`;
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
  const results = await Promise.all(
    uniqueIdxs.map(async (i) => {
      const [lng, lat] = geometry[i]!;
      const r = await fetchCurrentWeatherHeadline(apiKey, lat, lng);
      byIdx.set(i, r);
      return r;
    })
  );

  const precipHint = results.reduce((m, r) => Math.max(m, r.precipHint), 0);
  const headline = results.map((r) => r.headline).join(" · ");

  const samples: WeatherHintSample[] = ts.map((t, j) => {
    const idx = idxs[j]!;
    const r = byIdx.get(idx) ?? { headline: "conditions", precipHint: 0 };
    return { t, precipHint: r.precipHint, headline: r.headline };
  });

  return { headline, precipHint, samples };
}
