import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/** Min move before refreshing the forecast area reverse-geocode label. */
export const FORECAST_REVERSE_GEOCODE_MIN_MOVE_M = 800;
/** Cap how often we reverse-geocode even when moving a lot (Mapbox Temporary Geocoding). */
export const FORECAST_REVERSE_GEOCODE_MIN_INTERVAL_MS = 5 * 60_000;

/**
 * Whether to spend a Mapbox reverse-geocode call for the forecast place label.
 * GPS updates every ~1s; without this gate we burn Temporary Geocoding quota continuously.
 */
export function shouldRefreshForecastReverseGeocode(input: {
  next: LngLat;
  lastLngLat: LngLat | null;
  lastFetchedAtMs: number | null;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();
  if (!input.lastLngLat || input.lastFetchedAtMs == null) return true;
  const movedM = haversineMeters(input.lastLngLat, input.next);
  if (movedM < FORECAST_REVERSE_GEOCODE_MIN_MOVE_M) return false;
  if (now - input.lastFetchedAtMs < FORECAST_REVERSE_GEOCODE_MIN_INTERVAL_MS) return false;
  return true;
}
