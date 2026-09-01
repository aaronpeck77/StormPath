import { samplePolylineForMapbox } from "../services/mapboxDirectionsTraffic";
import {
  closestAlongRouteMeters,
  closestPointOnPolyline,
  polylineLengthMeters,
  slicePolylineBetweenAlong,
} from "./routeGeometry";
import type { TripStop } from "./routeWaypoints";
import type { LngLat } from "./types";

/** Mapbox Directions / Navigation waypoint cap (origin + vias + dest). */
export const NATIVE_GUIDANCE_MAX_COORDS = 25;
/** Start slightly behind the puck so Core does not think we skipped the first via. */
const CORRIDOR_ORIGIN_PAD_M = 40;
/** Insert a via at the farthest bulge from origin→dest so Core cannot skip a B-shaped detour. */
const DISTINCTIVE_VIA_MIN_LATERAL_M = 400;

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

/** Vertex farthest from the OD chord — the shape that makes B different from A. */
export function distinctiveCorridorVertex(geometry: LngLat[]): LngLat | null {
  if (geometry.length < 3) return null;
  const chord = [geometry[0]!, geometry[geometry.length - 1]!];
  let best: LngLat | null = null;
  let bestD = 0;
  for (let i = 1; i < geometry.length - 1; i++) {
    const p = geometry[i]!;
    const d = closestPointOnPolyline(p, chord).lateralMetersApprox;
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD >= DISTINCTIVE_VIA_MIN_LATERAL_M ? best : null;
}

function insertLngLatInAlongOrder(sampled: LngLat[], extra: LngLat): LngLat[] {
  if (sampled.some((p) => p[0] === extra[0] && p[1] === extra[1])) return sampled;
  const extraAlong = closestAlongRouteMeters(extra, sampled).alongMeters;
  const out: LngLat[] = [];
  let inserted = false;
  let cum = 0;
  for (let i = 0; i < sampled.length; i++) {
    if (!inserted && extraAlong <= cum + 1) {
      out.push(extra);
      inserted = true;
    }
    out.push(sampled[i]!);
    if (i < sampled.length - 1) {
      const a = sampled[i]!;
      const b = sampled[i + 1]!;
      const dlng = a[0] - b[0];
      const dlat = a[1] - b[1];
      cum += Math.hypot(dlng, dlat) * 111_320;
    }
  }
  if (!inserted) out.splice(Math.max(1, out.length - 1), 0, extra);
  return out;
}

/**
 * Build Core start coordinates that follow the Go-locked corridor when available.
 * Bare origin→dest lets Mapbox recalculate highway-fastest and yank a chosen alternate.
 * Seed from the remaining corridor near GPS so Core does not start miles behind the puck.
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
    const budget = Math.min(max, NATIVE_GUIDANCE_MAX_COORDS);
    let sampled = samplePolylineForMapbox(remaining, budget);
    const bulge = distinctiveCorridorVertex(remaining);
    if (bulge && sampled.length < budget) {
      sampled = insertLngLatInAlongOrder(sampled, bulge).slice(0, budget);
    } else if (bulge && sampled.length >= 3) {
      sampled = insertLngLatInAlongOrder(sampled.slice(0, -1), bulge).slice(0, budget - 1);
      sampled.push(remaining[remaining.length - 1]!);
    }
    if (sampled.length >= 2) {
      if (input.userLngLat) {
        sampled = [
          [input.userLngLat[0], input.userLngLat[1]],
          ...sampled.slice(1),
        ];
      }
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
