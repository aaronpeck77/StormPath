import { isDaylightAt } from "../forecast/solarDayNight";

type LngLat = [number, number];

function clockFallbackDaytime(nowMs = Date.now()): boolean {
  const h = new Date(nowMs).getHours();
  return h >= 6 && h < 20;
}

/**
 * Same solar window as {@link DriveMap} day vs night — used to style chrome when the basemap is night.
 * Uses sunrise/sunset at the user's location when GPS is available; otherwise falls back to local clock.
 */
export function isMapBasemapDaytime(lngLat?: LngLat | null, nowMs = Date.now()): boolean {
  if (lngLat && Number.isFinite(lngLat[0]) && Number.isFinite(lngLat[1])) {
    return isDaylightAt(lngLat[1], lngLat[0], nowMs);
  }
  return clockFallbackDaytime(nowMs);
}
