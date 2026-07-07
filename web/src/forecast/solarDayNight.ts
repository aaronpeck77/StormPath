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
 * True during civil night (after dusk or before dawn) at `lat`/`lng`.
 * Uses civil twilight so the band starts slightly before temps fully drop.
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
