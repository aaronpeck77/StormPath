import { samplePolylineForMapbox } from "../services/mapboxDirectionsTraffic";
import type { TripStop } from "./routeWaypoints";
import type { LngLat } from "./types";

/** Mapbox Directions / Navigation waypoint cap (origin + vias + dest). */
export const NATIVE_GUIDANCE_MAX_COORDS = 25;

export type NativeGuidanceCoord = { lng: number; lat: number };

/**
 * Build Core start coordinates that follow the Go-locked corridor when available.
 * Bare origin→dest lets Mapbox recalculate highway-fastest and yank a chosen alternate.
 */
export function buildNativeGuidanceCoordinates(input: {
  userLngLat: LngLat | null;
  viaStops: TripStop[];
  destLngLat: LngLat | null;
  /** Go-locked polyline — preferred seed for Core. */
  lockedCorridor?: LngLat[] | null;
  maxCoords?: number;
}): NativeGuidanceCoord[] | null {
  const max = input.maxCoords ?? NATIVE_GUIDANCE_MAX_COORDS;
  const corridor = input.lockedCorridor;
  if (corridor && corridor.length >= 2) {
    const sampled = samplePolylineForMapbox(corridor, Math.min(max, NATIVE_GUIDANCE_MAX_COORDS));
    if (sampled.length >= 2) {
      return sampled.map(([lng, lat]) => ({ lng, lat }));
    }
  }

  if (!input.userLngLat || !input.destLngLat) return null;
  const out: NativeGuidanceCoord[] = [
    { lng: input.userLngLat[0], lat: input.userLngLat[1] },
  ];
  for (const stop of input.viaStops) {
    const v = stop?.lngLat;
    if (!v || v.length < 2) continue;
    out.push({ lng: v[0], lat: v[1] });
  }
  out.push({ lng: input.destLngLat[0], lat: input.destLngLat[1] });
  return out.length >= 2 ? out : null;
}
