import {
  closestAlongRouteMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
  slicePolylineBetweenAlong,
} from "./routeGeometry";
import type { TripStop } from "./routeWaypoints";
import type { LngLat } from "./types";

/** Mapbox Directions / Navigation waypoint cap (origin + vias + dest + silent shapes). */
export const NATIVE_GUIDANCE_MAX_COORDS = 16;
/** Start slightly behind the puck so Core does not think we skipped the first via. */
const CORRIDOR_ORIGIN_PAD_M = 40;
/** First/last silent shape — keeps Core on neighborhood streets instead of a yard chord. */
const SHAPE_NEAR_M = 2_800;
/** Sparse mid-corridor shapes on long trips (not a dense 25-point sample). */
const SHAPE_STEP_M = 90_000;
const SHAPE_MAX_SILENT = 12;

export type NativeGuidanceCoord = {
  lng: number;
  lat: number;
  /** True = real stop (new leg). False = silent corridor shape. */
  separatesLegs?: boolean;
  /** Departing bearing for the origin waypoint (degrees). */
  headingDeg?: number;
};

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

function collectShapingAlong(remaining: LngLat[], maxSilent: number): LngLat[] {
  const total = polylineLengthMeters(remaining);
  if (total < SHAPE_NEAR_M * 2.2 || maxSilent < 1) return [];
  const targets: number[] = [Math.min(SHAPE_NEAR_M, total * 0.08)];
  let m = SHAPE_NEAR_M + SHAPE_STEP_M;
  while (m < total - SHAPE_NEAR_M && targets.length < maxSilent - 1) {
    targets.push(m);
    m += SHAPE_STEP_M;
  }
  const last = total - SHAPE_NEAR_M;
  if (last > targets[targets.length - 1]! + 1_000) {
    targets.push(last);
  }
  return targets.map((t) => pointAtAlongMeters(remaining, t));
}

/**
 * Core waypoints: origin, sparse on-road shapes, real vias, dest.
 * Dense 25-point samples looped off-road; bare origin→dest cut yards on long trips.
 */
export function buildNativeGuidanceCoordinates(input: {
  userLngLat: LngLat | null;
  viaStops: TripStop[];
  destLngLat: LngLat | null;
  /** Go-locked polyline — preferred seed for Core. */
  lockedCorridor?: LngLat[] | null;
  maxCoords?: number;
  headingDeg?: number | null;
}): NativeGuidanceCoord[] | null {
  const max = input.maxCoords ?? NATIVE_GUIDANCE_MAX_COORDS;
  const heading =
    input.headingDeg != null && Number.isFinite(input.headingDeg) ? input.headingDeg : undefined;
  const corridor = input.lockedCorridor;

  if (corridor && corridor.length >= 2) {
    const remaining = remainingCorridorFromUser(corridor, input.userLngLat);
    const dest = remaining[remaining.length - 1]!;
    const origin: LngLat = input.userLngLat ?? remaining[0]!;
    const originC: NativeGuidanceCoord = { ...toCoord(origin), headingDeg: heading };
    const destC = toCoord(dest);
    const marks: { along: number; coord: NativeGuidanceCoord }[] = [];

    for (const p of collectShapingAlong(remaining, Math.min(SHAPE_MAX_SILENT, max - 2))) {
      marks.push({
        along: closestAlongRouteMeters(p, remaining).alongMeters,
        coord: { ...toCoord(p), separatesLegs: false },
      });
    }
    for (const stop of input.viaStops) {
      const v = stop?.lngLat;
      if (!v || v.length < 2) continue;
      marks.push({
        along: closestAlongRouteMeters(v, remaining).alongMeters,
        coord: { ...toCoord(v), separatesLegs: true },
      });
    }
    marks.sort((a, b) => a.along - b.along);

    const out: NativeGuidanceCoord[] = [originC];
    for (const mark of marks) {
      if (!sameCoord(mark.coord, out[out.length - 1]!)) out.push(mark.coord);
    }
    if (!sameCoord(out[out.length - 1]!, destC)) out.push(destC);
    if (out.length >= 2) return out.slice(0, max);
  }

  if (!input.userLngLat || !input.destLngLat) return null;
  const out: NativeGuidanceCoord[] = [
    { lng: input.userLngLat[0], lat: input.userLngLat[1], headingDeg: heading },
  ];
  for (const stop of input.viaStops) {
    const v = stop?.lngLat;
    if (!v || v.length < 2) continue;
    out.push({ lng: v[0], lat: v[1], separatesLegs: true });
  }
  out.push({ lng: input.destLngLat[0], lat: input.destLngLat[1] });
  return out.length >= 2 ? out : null;
}
