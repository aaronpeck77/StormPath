import {
  haversineMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "../nav/routeGeometry";
import type { LngLat, NavRoute } from "../nav/types";
import {
  ACTIVITY_MIN_SAMPLES_RANK,
  loadActivitySamples,
  type ActivitySample,
} from "./activitySamples";

/** Route sample within this distance of a trail dot counts as “familiar corridor”. */
export const TRAIL_CORRIDOR_M = 160;
/** Spacing between overlap checks along the polyline. */
export const TRAIL_ROUTE_SAMPLE_STEP_M = 280;
/** Default preview may favor a familiar alt up to this much slower than fastest (A). */
export const TRAIL_ROUTE_MAX_ETA_FACTOR = 1.12;
/** Minimum overlap fraction before we treat a route as “familiar”. */
export const TRAIL_ROUTE_MIN_OVERLAP = 0.08;

export function routeTrailOverlapScore(
  geometry: LngLat[],
  samples: ActivitySample[],
  minSamples = ACTIVITY_MIN_SAMPLES_RANK
): number {
  if (geometry.length < 2 || samples.length < minSamples) return 0;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of geometry) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  const padDeg = TRAIL_CORRIDOR_M / 85_000;
  const nearby = samples.filter(
    (s) =>
      s.lng >= minLng - padDeg &&
      s.lng <= maxLng + padDeg &&
      s.lat >= minLat - padDeg &&
      s.lat <= maxLat + padDeg
  );
  if (nearby.length < 4) return 0;

  const totalM = polylineLengthMeters(geometry);
  if (totalM < 80) return 0;

  const step = Math.max(TRAIL_ROUTE_SAMPLE_STEP_M, totalM / 40);
  let hits = 0;
  let checks = 0;
  for (let d = 0; d <= totalM; d += step) {
    const pt = pointAtAlongMeters(geometry, d);
    checks++;
    let minD = Infinity;
    for (const s of nearby) {
      const dm = haversineMeters(pt, [s.lng, s.lat]);
      if (dm < minD) minD = dm;
      if (minD <= TRAIL_CORRIDOR_M) break;
    }
    if (minD <= TRAIL_CORRIDOR_M) hits++;
  }
  return checks > 0 ? hits / checks : 0;
}

/** Pick the leg to preview first when it overlaps your trail and is not much slower than A. */
export function pickTrailPreferredRouteId(
  routes: NavRoute[],
  samples: ActivitySample[] = loadActivitySamples()
): string | null {
  if (routes.length < 2 || samples.length < ACTIVITY_MIN_SAMPLES_RANK) return null;
  const primary = routes.find((r) => r.id === "r-a") ?? routes[0]!;
  const maxEta = primary.baseEtaMinutes * TRAIL_ROUTE_MAX_ETA_FACTOR;

  let bestId: string | null = null;
  let bestScore = 0;
  for (const r of routes) {
    if (r.baseEtaMinutes > maxEta) continue;
    const score = routeTrailOverlapScore(r.geometry, samples);
    if (score > bestScore) {
      bestScore = score;
      bestId = r.id;
    }
  }
  return bestScore >= TRAIL_ROUTE_MIN_OVERLAP ? bestId : null;
}

export function compareRouteTrailOverlapDesc(
  a: LngLat[],
  b: LngLat[],
  samples: ActivitySample[]
): number {
  return routeTrailOverlapScore(b, samples) - routeTrailOverlapScore(a, samples);
}
