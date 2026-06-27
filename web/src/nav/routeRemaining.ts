import { polylineLengthMeters, slicePolylineBetweenAlong } from "./routeGeometry";
import type { LngLat } from "./types";

/** Minimum along-route progress before traffic fetch uses a remaining-leg slice (m). */
export const TRAFFIC_REMAINING_SLICE_MIN_ALONG_M = 25;

/**
 * Polyline for Mapbox traffic while navigating — from the driver through the destination,
 * not origin-to-destination (avoids stale full-trip minutes after reroute / late join).
 */
export function geometryForRemainingTrafficFetch(
  geometry: LngLat[],
  alongM: number,
  userLngLat: LngLat | null | undefined
): LngLat[] {
  if (geometry.length < 2) return geometry;
  const totalM = polylineLengthMeters(geometry);
  if (
    !Number.isFinite(alongM) ||
    alongM <= TRAFFIC_REMAINING_SLICE_MIN_ALONG_M ||
    alongM >= totalM - TRAFFIC_REMAINING_SLICE_MIN_ALONG_M
  ) {
    return geometry;
  }
  let slice = slicePolylineBetweenAlong(geometry, alongM, totalM);
  if (slice.length < 2) return geometry;
  if (userLngLat) {
    slice = [userLngLat, ...slice.slice(1)];
  }
  return slice;
}

/** Coordinates from just before the closest vertex to the user through the destination (remaining path). */
export function sliceRouteAhead(geometry: LngLat[], userLngLat: LngLat): LngLat[] {
  if (geometry.length < 2) return geometry;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < geometry.length; i++) {
    const [lng, lat] = geometry[i]!;
    const d = (lng - userLngLat[0]) ** 2 + (lat - userLngLat[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const start = Math.max(0, bestI - 1);
  return geometry.slice(start);
}
