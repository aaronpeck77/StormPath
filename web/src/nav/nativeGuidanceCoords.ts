import {
  closestAlongRouteMeters,
  polylineLengthMeters,
  slicePolylineBetweenAlong,
} from "./routeGeometry";
import type { TripStop } from "./routeWaypoints";
import type { LngLat } from "./types";

/** Mapbox Directions / Navigation waypoint cap (origin + vias + dest). */
export const NATIVE_GUIDANCE_MAX_COORDS = 25;
/** Start slightly behind the puck so Core does not think we skipped the first via. */
const CORRIDOR_ORIGIN_PAD_M = 40;

export type NativeGuidanceCoord = { lng: number; lat: number };

function remainingCorridorFromUser(corridor: LngLat[], userLngLat: LngLat | null): LngLat[] {
  if (!userLngLat || corridor.length < 2) return corridor;
  const total = polylineLengthMeters(corridor);
  if (total < 80) return corridor;
  const along = closestAlongRouteMeters(userLngLat, corridor).alongMeters;
  const startM = Math.max(0, Math.min(total - 50, along - CORRIDOR_ORIGIN_PAD_M));
  const remaining = slicePolylineBetweenAlong(corridor, startM, total);
  return remaining.length >= 2 ? remaining : corridor;
}

function toCoord(p: LngLat): NativeGuidanceCoord {
  return { lng: p[0], lat: p[1] };
}

function sameCoord(a: NativeGuidanceCoord, b: NativeGuidanceCoord): boolean {
  return Math.abs(a.lng - b.lng) < 1e-6 && Math.abs(a.lat - b.lat) < 1e-6;
}

/**
 * Core waypoints: origin, real via stops, dest.
 * Dense corridor samples (and even one off-road bulge) made Core snap
 * to the wrong street and draw unnecessary loops.
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
    const remaining = remainingCorridorFromUser(corridor, input.userLngLat);
    const dest = remaining[remaining.length - 1]!;
    const origin: LngLat = input.userLngLat ?? remaining[0]!;
    const out: NativeGuidanceCoord[] = [toCoord(origin)];
    for (const stop of input.viaStops) {
      const v = stop?.lngLat;
      if (!v || v.length < 2) continue;
      const c = toCoord(v);
      if (!sameCoord(c, out[out.length - 1]!)) out.push(c);
    }
    const destC = toCoord(dest);
    if (!sameCoord(out[out.length - 1]!, destC)) out.push(destC);
    if (out.length >= 2) return out.slice(0, max);
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
