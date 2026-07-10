import * as SunCalc from "suncalc";

export type SunTimesMs = {
  /** Civil dawn (−6°) */
  dawnMs: number;
  /** Standard sunrise (−0.833°) */
  sunriseMs: number;
  /** Standard sunset */
  sunsetMs: number;
  /** Civil dusk (−6°) */
  duskMs: number;
};

function sunTimeMs(value: Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Civil and standard sun times at a location for the given instant's calendar day. */
export function sunTimesAt(lat: number, lng: number, date: Date): SunTimesMs | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const t = SunCalc.getTimes(date, lat, lng);
  const dawnMs = sunTimeMs(t.dawn);
  const sunriseMs = sunTimeMs(t.sunrise);
  const sunsetMs = sunTimeMs(t.sunset);
  const duskMs = sunTimeMs(t.dusk);
  if (dawnMs == null || sunriseMs == null || sunsetMs == null || duskMs == null) {
    return null;
  }
  return { dawnMs, sunriseMs, sunsetMs, duskMs };
}

/**
 * Rough US time zone for formatting local sun times along a route.
 * Accurate enough for CONUS corridor drives (IL → CA, etc.).
 */
export function approximateUsTimeZone(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "UTC";
  if (lng < -130) return "America/Anchorage";
  if (lng < -115) return "America/Los_Angeles";
  if (lng < -102) return "America/Denver";
  if (lng < -87) return "America/Chicago";
  return "America/New_York";
}

/** Local clock label for a sun event at lat/lng (includes short TZ). */
export function formatSolarLocalTime(ms: number, lat: number, lng: number): string {
  const tz = approximateUsTimeZone(lat, lng);
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  });
}

/**
 * Apparent altitude thresholds for {@link SunCalc.getPosition} (refraction-corrected).
 * These match getPosition() at getTimes() sunrise/sunset (~−0.35°) and dawn/dusk (~−5.5°),
 * not the raw geometric angles (−0.833° / −6°) used inside getTimes().
 */
const GEOMETRIC_HORIZON_ALT_DEG = -0.4;
/** Civil twilight — outdoors still looks bright until the sun is about here. */
const CIVIL_TWILIGHT_ALT_DEG = -5.5;

/**
 * Sun altitude in degrees at lat/lng. Prefer this over comparing getTimes() dawn/dusk
 * timestamps — those are anchored to a UTC calendar day and misclassify US evenings
 * after 00:00 UTC (e.g. 7pm CDT) as "before dawn".
 */
export function sunAltitudeDegrees(lat: number, lng: number, timeMs: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(timeMs)) return null;
  try {
    const pos = SunCalc.getPosition(new Date(timeMs), lat, lng);
    const alt = pos?.altitude;
    return typeof alt === "number" && Number.isFinite(alt) ? alt : null;
  } catch {
    return null;
  }
}

/**
 * True when the sun is above the geometric horizon (between sunrise and sunset).
 * Used for route-graph night bands / sun-crossing events — not the map basemap
 * (map uses civil twilight via {@link isNightAt}).
 */
export function isDaylightAt(lat: number, lng: number, timeMs: number): boolean {
  const alt = sunAltitudeDegrees(lat, lng, timeMs);
  if (alt == null) return true;
  return alt >= GEOMETRIC_HORIZON_ALT_DEG;
}

/** True after sunset or before sunrise (geometric night). For route graphs / sun events. */
export function isAstronomicalNightAt(lat: number, lng: number, timeMs: number): boolean {
  return !isDaylightAt(lat, lng, timeMs);
}

/**
 * True during civil night (sun below −6°) at `lat`/`lng`.
 * Used for map basemap day/night and local forecast strips — outdoors still looks
 * bright between geometric sunset and civil dusk.
 */
export function isNightAt(lat: number, lng: number, timeMs: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(timeMs)) return false;
  const alt = sunAltitudeDegrees(lat, lng, timeMs);
  if (alt == null) return false;
  return alt < CIVIL_TWILIGHT_ALT_DEG;
}
