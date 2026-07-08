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
 * True when the sun is above the horizon (between sunrise and sunset).
 * Used for map basemap day vs night.
 */
export function isDaylightAt(lat: number, lng: number, timeMs: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(timeMs)) return true;
  const t = SunCalc.getTimes(new Date(timeMs), lat, lng);
  if (t.alwaysDown) return false;
  if (t.alwaysUp) return true;

  const sunriseMs = sunTimeMs(t.sunrise);
  const sunsetMs = sunTimeMs(t.sunset);
  if (sunriseMs != null && sunsetMs != null) {
    return timeMs >= sunriseMs && timeMs < sunsetMs;
  }
  return true;
}

/** True after sunset or before sunrise (astronomical night). Matches map day/night. */
export function isAstronomicalNightAt(lat: number, lng: number, timeMs: number): boolean {
  return !isDaylightAt(lat, lng, timeMs);
}

/**
 * True during civil night (after dusk or before dawn) at `lat`/`lng`.
 * Uses civil twilight — for local hourly forecast strips, not route graphs.
 */
export function isNightAt(lat: number, lng: number, timeMs: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(timeMs)) return false;
  const t = SunCalc.getTimes(new Date(timeMs), lat, lng);
  if (t.alwaysDown) return true;
  if (t.alwaysUp) return false;

  const dawnMs = sunTimeMs(t.dawn);
  const duskMs = sunTimeMs(t.dusk);
  if (dawnMs != null && duskMs != null) {
    return timeMs >= duskMs || timeMs < dawnMs;
  }

  const sunriseMs = sunTimeMs(t.sunrise);
  const sunsetMs = sunTimeMs(t.sunset);
  if (sunriseMs != null && sunsetMs != null) {
    return timeMs >= sunsetMs || timeMs < sunriseMs;
  }

  return false;
}
