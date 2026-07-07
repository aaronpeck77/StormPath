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

/** Civil and standard sun times at a location for the given instant's calendar day. */
export function sunTimesAt(lat: number, lng: number, date: Date): SunTimesMs | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const t = SunCalc.getTimes(date, lat, lng);
  return {
    dawnMs: t.dawn.getTime(),
    sunriseMs: t.sunrise.getTime(),
    sunsetMs: t.sunset.getTime(),
    duskMs: t.dusk.getTime(),
  };
}

/**
 * True during civil night (after dusk or before dawn) at `lat`/`lng`.
 * Uses civil twilight so the band starts slightly before temps fully drop.
 */
export function isNightAt(lat: number, lng: number, timeMs: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(timeMs)) return false;
  const t = SunCalc.getTimes(new Date(timeMs), lat, lng);
  const dawnMs = t.dawn.getTime();
  const duskMs = t.dusk.getTime();
  if (!Number.isFinite(dawnMs) || !Number.isFinite(duskMs)) return false;
  return timeMs >= duskMs || timeMs < dawnMs;
}
