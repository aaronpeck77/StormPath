import { isNightAt } from "../forecast/solarDayNight";

type LngLat = [number, number];

/** No-GPS fallback — roughly civil twilight in mid-latitudes summer. */
function clockFallbackDaytime(nowMs = Date.now()): boolean {
  const h = new Date(nowMs).getHours();
  return h >= 5 && h < 21;
}

/**
 * Same solar window as {@link DriveMap} day vs night — used to style chrome when the basemap is night.
 * Uses civil dawn/dusk at the user's location (still bright after geometric sunset);
 * falls back to local clock when GPS is unavailable.
 */
export function isMapBasemapDaytime(lngLat?: LngLat | null, nowMs = Date.now()): boolean {
  if (lngLat && Number.isFinite(lngLat[0]) && Number.isFinite(lngLat[1])) {
    return !isNightAt(lngLat[1], lngLat[0], nowMs);
  }
  return clockFallbackDaytime(nowMs);
}
