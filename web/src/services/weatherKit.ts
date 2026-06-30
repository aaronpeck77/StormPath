/**
 * WeatherKit adapters — same shapes as {@link ./tomorrowIo} so hooks/UI stay unchanged.
 */
import type { CurrentNowcast } from "./openWeatherClient";
import {
  buildTimelinesWaypointsForGeometry,
  pickRouteForecastFetchLocations,
  routeForecastLocationKey,
  type MinutePrecipForecast,
  type PointHourlyForecast,
  type PointDailyForecast,
  type PointDailyDay,
  type RouteForecast,
  type RouteHourlyInterval,
  weatherCodeLabel,
} from "./tomorrowIo";
import type { LngLat } from "../nav/types";
import { resolveHourFeelsLikeF } from "../forecast/localForecastVisual";
import {
  accumulateFeelsIntoDailyPeriods,
  dailyPeriodBoundsFromDays,
  type DailyApparentExtremes,
} from "../forecast/localForecastDaily";
import { calibratedWindGustMph } from "../nav/windForecastCalib";
import { fetchWeatherKitAtPoint, type WeatherKitAlert } from "./weatherKitClient";
import { isWeatherKitTokenBlocked } from "./weatherKitAuth";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";

export { isWeatherKitTokenBlocked } from "./weatherKitAuth";

/** Map WeatherKit condition codes to Tomorrow.io-style codes for shared severity logic. */
export function weatherKitConditionToCode(condition: string): number {
  const c = condition.toLowerCase();
  if (c.includes("thunder") || c === "strongstorms") return 8000;
  if (c === "hail") return 8000;
  if (c === "heavyrain") return 4201;
  if (c === "rain" || c === "sunshowers") return 4001;
  if (c === "drizzle") return 4000;
  if (c === "freezingdrizzle") return 6000;
  if (c === "freezingrain" || c === "wintrymix" || c.includes("freezing") || c === "sleet")
    return 6001;
  if (c === "heavysnow" || c === "blizzard" || c === "blowingsnow") return 5101;
  if (c === "snow" || c === "flurries") return 5000;
  if (c === "fog" || c === "haze" || c === "smoky") return 2000;
  if (c === "mostlyclear") return 1100;
  if (c === "partlycloudy") return 1101;
  if (c === "mostlycloudy") return 1102;
  if (c === "cloudy") return 1001;
  return 1000;
}

function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

/** WeatherKit REST windSpeed / windGust are km/h (matches native Wind.speed in km/h). */
function kphToMph(kph: number): number {
  return kph * 0.621371;
}

function precipTypeToNumber(type: string | undefined): number {
  const t = (type ?? "").toLowerCase();
  if (t.includes("snow")) return 2;
  if (t.includes("sleet") || t.includes("hail")) return 4;
  if (t.includes("freez")) return 3;
  if (t.includes("rain")) return 1;
  return 0;
}

function estimateWetRoadMm(intensityMmh: number, amountMm: number): number {
  return Math.min(10, intensityMmh * 0.6 + amountMm * 0.25);
}

function nearestHourlyForEta(
  hours: { forecastStart: string; values: ReturnType<typeof mapHourlyValues> }[],
  etaMinutes: number,
  tripStartMs: number
): ReturnType<typeof mapHourlyValues> {
  const targetMs = tripStartMs + etaMinutes * 60_000;
  let best = hours[0]?.values;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const h of hours) {
    const d = Math.abs(new Date(h.forecastStart).getTime() - targetMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = h.values;
    }
  }
  return (
    best ?? {
      temperature: 21,
      temperatureApparent: undefined,
      precipitationIntensity: 0,
      precipitationProbability: 0,
      windSpeed: 0,
      windGust: 0,
      weatherCode: 1000,
      wetRoadIndex: 0,
      visibilityM: undefined,
    }
  );
}

function mapHourlyValues(h: {
  temperature: number;
  temperatureApparent?: number;
  precipitationIntensity: number;
  precipitationChance: number;
  precipitationAmount: number;
  windSpeed: number;
  windGust?: number;
  conditionCode: string;
  visibility?: number;
}) {
  return {
    temperature: h.temperature,
    temperatureApparent: h.temperatureApparent,
    precipitationIntensity: h.precipitationIntensity,
    precipitationProbability: h.precipitationChance,
    windSpeed: h.windSpeed,
    windGust: h.windGust ?? h.windSpeed,
    weatherCode: weatherKitConditionToCode(h.conditionCode),
    wetRoadIndex: estimateWetRoadMm(h.precipitationIntensity, h.precipitationAmount),
    visibilityM: h.visibility,
  };
}

export async function fetchWeatherKitMinutePrecip(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<MinutePrecipForecast> {
  const raw = await fetchWeatherKitAtPoint(
    lat,
    lng,
    ["currentWeather", "forecastNextHour"],
    signal
  );
  const cur = raw.currentWeather;
  const minutes = raw.forecastNextHour?.minutes ?? [];
  const code = weatherKitConditionToCode(cur?.conditionCode ?? "Clear");
  return {
    fetchedAt: Date.now(),
    lat,
    lng,
    now: cur
      ? {
          tempF: Math.round(cToF(cur.temperature)),
          windMph: Math.round(kphToMph(cur.windSpeed)),
          conditions: weatherCodeLabel(code),
        }
      : undefined,
    minutes: minutes.map((m) => ({
      timeIso: m.startTime,
      precipIntensityMmh: m.precipitationIntensity,
      precipProbability: m.precipitationChance,
      precipType: precipTypeToNumber(m.precipitationType),
    })),
  };
}

function formatDailyDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long" });
}

function buildWeatherKitPointHourly(
  raw: Awaited<ReturnType<typeof fetchWeatherKitAtPoint>>,
  lat: number,
  lng: number,
  fetchedAt: number
): PointHourlyForecast {
  const rawHours = raw.forecastHourly?.hours ?? [];
  const hours = rawHours
    .filter((h) => new Date(h.forecastStart).getTime() + 3_600_000 > fetchedAt)
    .slice(0, 48)
    .map((h) => mapWeatherKitHourlyPoint(h, fetchedAt));
  return {
    fetchedAt,
    lat,
    lng,
    hours,
    provider: "weatherKit",
  };
}

function mapWeatherKitHourlyPoint(
  h: NonNullable<Awaited<ReturnType<typeof fetchWeatherKitAtPoint>>["forecastHourly"]>["hours"][number],
  fetchedAt: number
) {
  const code = weatherKitConditionToCode(h.conditionCode);
  const gust = h.windGust != null ? Math.round(kphToMph(h.windGust)) : undefined;
  const tempF = Math.round(cToF(h.temperature));
  const humidityPct = Math.round(h.humidity * 100);
  const windMph = Math.round(kphToMph(h.windSpeed));
  return {
    timeIso: h.forecastStart,
    offsetHours: (new Date(h.forecastStart).getTime() - fetchedAt) / 3_600_000,
    tempF,
    feelsLikeF: resolveHourFeelsLikeF({
      tempF,
      feelsLikeF: Math.round(cToF(h.temperatureApparent)),
      humidityPct,
      windMph: gust ?? windMph,
    }),
    humidityPct,
    precipIntensityMmh: h.precipitationIntensity,
    precipProbability: h.precipitationChance,
    precipType: precipTypeToNumber(h.precipitationType),
    windMph: Math.round(kphToMph(h.windSpeed)),
    windGustMph: gust,
    conditions: weatherCodeLabel(code),
  };
}

function apparentExtremesByDailyPeriodFromRawHourly(
  rawHours: NonNullable<Awaited<ReturnType<typeof fetchWeatherKitAtPoint>>["forecastHourly"]>["hours"],
  dailyStarts: string[]
): DailyApparentExtremes[] {
  const bounds = dailyPeriodBoundsFromDays(dailyStarts.map((dateIso) => ({ dateIso })));
  const out: DailyApparentExtremes[] = dailyStarts.map(() => ({}));
  for (const h of rawHours) {
    const hourMs = new Date(h.forecastStart).getTime();
    if (!Number.isFinite(hourMs)) continue;
    const tempF = Math.round(cToF(h.temperature));
    const windMph = Math.round(
      kphToMph(h.windGust != null ? h.windGust : h.windSpeed)
    );
    const feels = resolveHourFeelsLikeF({
      tempF,
      feelsLikeF: Math.round(cToF(h.temperatureApparent)),
      humidityPct: Math.round(h.humidity * 100),
      windMph,
    });
    accumulateFeelsIntoDailyPeriods(bounds, out, hourMs, feels);
  }
  return out;
}

function buildWeatherKitPointDaily(
  raw: Awaited<ReturnType<typeof fetchWeatherKitAtPoint>>,
  lat: number,
  lng: number,
  fetchedAt: number
): PointDailyForecast {
  const rawDaily = (raw.forecastDaily?.days ?? []).slice(0, 7);
  const dailyStarts = rawDaily.map((d) => d.forecastStart);
  const feelsExtremes = apparentExtremesByDailyPeriodFromRawHourly(
    raw.forecastHourly?.hours ?? [],
    dailyStarts
  );
  const days: PointDailyDay[] = rawDaily.map((d, i) => {
    const code = weatherKitConditionToCode(d.conditionCode);
    const dayCode = d.daytimeForecast?.conditionCode
      ? weatherKitConditionToCode(d.daytimeForecast.conditionCode)
      : code;
    const nightCode = d.overnightForecast?.conditionCode
      ? weatherKitConditionToCode(d.overnightForecast.conditionCode)
      : code;
    return {
      dateIso: d.forecastStart,
      dayLabel: formatDailyDayLabel(d.forecastStart),
      highF: Math.round(cToF(d.temperatureMax)),
      lowF: Math.round(cToF(d.temperatureMin)),
      precipChance: d.precipitationChance,
      precipType: precipTypeToNumber(d.precipitationType),
      maxUvIndex: d.maxUvIndex != null ? Math.round(d.maxUvIndex) : undefined,
      snowfallCm:
        d.snowfallAmount != null && d.snowfallAmount > 0
          ? Math.round(d.snowfallAmount * 10) / 10
          : undefined,
      conditions: weatherCodeLabel(code),
      daytimeConditions: weatherCodeLabel(dayCode),
      overnightConditions: weatherCodeLabel(nightCode),
      maxFeelsLikeF: (() => {
        const peak = feelsExtremes[i]?.maxFeelsLikeF;
        return peak != null && Number.isFinite(peak) ? Math.round(peak) : undefined;
      })(),
      minFeelsLikeF: (() => {
        const low = feelsExtremes[i]?.minFeelsLikeF;
        return low != null && Number.isFinite(low) ? Math.round(low) : undefined;
      })(),
    };
  });
  return {
    fetchedAt,
    lat,
    lng,
    days,
    provider: "weatherKit",
  };
}

const LOCAL_POINT_CACHE_MS = 30 * 60 * 1000;
let localPointCache: {
  key: string;
  at: number;
  hourly: PointHourlyForecast;
  daily: PointDailyForecast;
} | null = null;
let localPointInflight: Promise<{ hourly: PointHourlyForecast; daily: PointDailyForecast }> | null =
  null;

function localPointKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** Hourly + daily at the user's position in one WeatherKit request (shared cache). */
export async function fetchWeatherKitPointLocal(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<{ hourly: PointHourlyForecast; daily: PointDailyForecast }> {
  const key = localPointKey(lat, lng);
  const now = Date.now();
  if (localPointCache && localPointCache.key === key && now - localPointCache.at < LOCAL_POINT_CACHE_MS) {
    return { hourly: localPointCache.hourly, daily: localPointCache.daily };
  }
  if (localPointInflight) return localPointInflight;

  localPointInflight = fetchWeatherKitAtPoint(
    lat,
    lng,
    ["forecastHourly", "forecastDaily"],
    signal
  )
    .then((raw) => {
      const fetchedAt = Date.now();
      const hourly = buildWeatherKitPointHourly(raw, lat, lng, fetchedAt);
      const daily = buildWeatherKitPointDaily(raw, lat, lng, fetchedAt);
      localPointCache = { key, at: fetchedAt, hourly, daily };
      return { hourly, daily };
    })
    .finally(() => {
      localPointInflight = null;
    });

  return localPointInflight;
}

export async function fetchWeatherKitPointHourly(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<PointHourlyForecast> {
  const { hourly } = await fetchWeatherKitPointLocal(lat, lng, signal);
  return hourly;
}

export async function fetchWeatherKitPointDaily(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<PointDailyForecast> {
  const { daily } = await fetchWeatherKitPointLocal(lat, lng, signal);
  return daily;
}

export async function fetchWeatherKitCurrentNowcast(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<CurrentNowcast> {
  const raw = await fetchWeatherKitAtPoint(lat, lng, ["currentWeather"], signal);
  const cur = raw.currentWeather;
  if (!cur) throw new Error("WeatherKit currentWeather missing");
  const gust = cur.windGust != null ? Math.round(kphToMph(cur.windGust)) : null;
  const tempF = Math.round(cToF(cur.temperature));
  const humidityPct = Math.round(cur.humidity * 100);
  const windMph = Math.round(kphToMph(cur.windSpeed));
  return {
    tempF,
    feelsLikeF: resolveHourFeelsLikeF({
      tempF,
      feelsLikeF: Math.round(cToF(cur.temperatureApparent)),
      humidityPct,
      windMph: gust ?? windMph,
    }),
    windMph: Math.round(kphToMph(cur.windSpeed)),
    windGustMph: gust,
    conditions: cur.conditionCode.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(),
    precipInPerHr: cur.precipitationIntensity / 25.4,
    humidityPct,
    uvIndex: Math.round(cur.uvIndex),
    fetchedAtMs: Date.now(),
  };
}

export async function fetchWeatherKitRouteForecast(
  waypoints: { lat: number; lng: number; etaMinutes: number }[],
  signal?: AbortSignal,
  opts?: { bypassCache?: boolean }
): Promise<RouteForecast> {
  if (!waypoints.length) return { fetchedAt: Date.now(), intervals: [] };

  const fetchLocations = pickRouteForecastFetchLocations(waypoints);
  const timelinesByKey = new Map<
    string,
    { forecastStart: string; values: ReturnType<typeof mapHourlyValues> }[]
  >();

  await Promise.all(
    fetchLocations.map(async (loc) => {
      const key = routeForecastLocationKey(loc.lat, loc.lng);
      const raw = await fetchWeatherKitAtPoint(
        loc.lat,
        loc.lng,
        ["forecastHourly"],
        signal,
        opts
      );
      const fetchedAt = Date.now();
      const hours = (raw.forecastHourly?.hours ?? []).map((h) => ({
        forecastStart: h.forecastStart,
        values: mapHourlyValues(h),
      }));
      timelinesByKey.set(key, hours.length ? hours : []);
      void fetchedAt;
    })
  );

  const fetchedAt = Date.now();
  const intervals: RouteHourlyInterval[] = waypoints.map((wp) => {
    const locKey = nearestLocationKey(wp, fetchLocations);
    const hourly = timelinesByKey.get(locKey) ?? [];
    const v = nearestHourlyForEta(hourly, wp.etaMinutes, fetchedAt);
    const windSpeedMph = kphToMph(v.windSpeed);
    const rawGustMph = v.windGust != null ? kphToMph(v.windGust) : windSpeedMph;
    const feelsLikeF =
      v.temperatureApparent != null ? cToF(v.temperatureApparent) : undefined;
    return {
      etaMinutes: wp.etaMinutes,
      lat: wp.lat,
      lng: wp.lng,
      tempF: cToF(v.temperature),
      feelsLikeF,
      precipIntensityMmh: v.precipitationIntensity,
      precipProbability: v.precipitationProbability,
      windSpeedMph,
      windGustMph: calibratedWindGustMph(windSpeedMph, rawGustMph),
      weatherCode: v.weatherCode,
      wetRoadMm: v.wetRoadIndex,
      visibilityM: v.visibilityM,
    };
  });

  return { fetchedAt, intervals };
}

function nearestLocationKey(
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

/** Re-export geometry helpers used by route forecast hooks. */
export { buildTimelinesWaypointsForGeometry };

export function weatherKitAvailable(): boolean {
  return !isWeatherKitTokenBlocked();
}

export async function fetchWeatherKitRouteForecastForGeometry(
  geometry: LngLat[],
  speedMps: number,
  signal?: AbortSignal,
  opts?: { bypassCache?: boolean }
): Promise<RouteForecast> {
  const waypoints = buildTimelinesWaypointsForGeometry(geometry, speedMps);
  if (!waypoints?.length) return { fetchedAt: Date.now(), intervals: [] };
  return fetchWeatherKitRouteForecast(waypoints, signal, opts);
}

/** Capitalize first letter of each word for display. */
function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

/** Map WeatherKit severity strings (lowercase) to NWS-style (capitalized). */
function wkSeverityToNws(s: string): string {
  const m: Record<string, string> = {
    extreme: "Extreme",
    severe: "Severe",
    moderate: "Moderate",
    minor: "Minor",
  };
  return m[s.toLowerCase()] ?? "Unknown";
}

/**
 * Coarse country code from coordinates — good enough for the `country=` WeatherKit param
 * which only needs to match the country where the alert is issued.
 */
function countryCodeFromCoords(lat: number, lng: number): string {
  if (lat >= 24 && lat <= 72 && lng >= -180 && lng <= -65) return "US";
  if (lat >= 42 && lat <= 84 && lng >= -141 && lng <= -52) return "CA";
  if (lat >= 14 && lat <= 33 && lng >= -118 && lng <= -86) return "MX";
  if (lat >= 49 && lat <= 61 && lng >= -10 && lng <= 2) return "GB";
  if (lat >= -44 && lat <= -10 && lng >= 113 && lng <= 154) return "AU";
  if (lat >= 47 && lat <= 55 && lng >= 6 && lng <= 15) return "DE";
  if (lat >= 42 && lat <= 51 && lng >= -5 && lng <= 9) return "FR";
  return "US";
}

/**
 * Fetch WeatherKit weather alerts at a point.
 * Returns normalized alerts compatible with the NWS advisory pipeline.
 * Works internationally — fills the advisory gap for non-US users where NWS has no coverage.
 * Apple requires a `country=` query parameter when requesting weatherAlerts.
 */
export async function fetchWeatherKitAlerts(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<NormalizedWeatherAlert[]> {
  const country = countryCodeFromCoords(lat, lng);
  const raw = await fetchWeatherKitAtPoint(lat, lng, ["weatherAlerts"], signal, { country });
  const alerts = raw.weatherAlerts?.alerts ?? [];

  return alerts.map((a: WeatherKitAlert): NormalizedWeatherAlert => {
    const event = a.eventOnset?.trim() || "Weather Alert";
    return {
      id: `wk-${a.id ?? `${lat}-${lng}-${event}`}`,
      regionCode: a.countryCode ?? "XX",
      providerId: "weatherkit",
      headline: event,
      event,
      description: a.description ?? "",
      severity: wkSeverityToNws(a.severity ?? ""),
      urgency: titleCase(a.urgency ?? "Unknown"),
      certainty: titleCase(a.certainty ?? "Unknown"),
      ends: a.expireTime ?? a.eventEnd ?? null,
      onset: a.eventOnset ?? null,
      geometry: null,
      areaDesc: a.areaName ?? a.areaId ?? "",
      stormMotionDeg: null,
      stormMotionMph: null,
    };
  });
}
