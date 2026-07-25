import {
  closestPointOnPolyline,
  haversineMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./routeGeometry";
import type { LngLat } from "./types";

/** Sample spacing along a candidate polyline when comparing to the Go-locked corridor. */
export const LOCKED_ROUTE_AGREE_SAMPLE_STEP_M = 400;
/** A sample counts as "on corridor" when within this of the locked line. */
export const LOCKED_ROUTE_AGREE_MAX_LATERAL_M = 450;
/** Fraction of candidate samples that must sit on the locked corridor. */
export const LOCKED_ROUTE_AGREE_MIN_FRACTION = 0.55;

/**
 * True when `candidate` largely follows the same corridor as `locked`.
 * Used to reject Mapbox Core "fastest" geometry that would silently replace a
 * preferred Go-locked (often no-interstate) blue line at session start.
 */
export function routeGeometryAgreesWithLocked(
  candidate: LngLat[],
  locked: LngLat[],
  opts?: {
    sampleStepM?: number;
    maxLateralM?: number;
    minAgreeFraction?: number;
  }
): boolean {
  if (candidate.length < 2 || locked.length < 2) return false;
  const totalM = polylineLengthMeters(candidate);
  if (totalM < 80) {
    const mid = candidate[Math.floor(candidate.length / 2)]!;
    return closestPointOnPolyline(mid, locked).lateralMetersApprox <= (opts?.maxLateralM ?? LOCKED_ROUTE_AGREE_MAX_LATERAL_M);
  }
  const step = Math.max(opts?.sampleStepM ?? LOCKED_ROUTE_AGREE_SAMPLE_STEP_M, totalM / 48);
  const maxLateral = opts?.maxLateralM ?? LOCKED_ROUTE_AGREE_MAX_LATERAL_M;
  const minFrac = opts?.minAgreeFraction ?? LOCKED_ROUTE_AGREE_MIN_FRACTION;
  let hits = 0;
  let checks = 0;
  for (let d = 0; d <= totalM; d += step) {
    const pt = pointAtAlongMeters(candidate, d);
    checks++;
    if (closestPointOnPolyline(pt, locked).lateralMetersApprox <= maxLateral) hits++;
  }
  /* Also require endpoints near the locked corridor so a highway fork with a shared
   * first mile doesn't count as agreement. */
  const startLat = closestPointOnPolyline(candidate[0]!, locked).lateralMetersApprox;
  const endLat = closestPointOnPolyline(candidate[candidate.length - 1]!, locked).lateralMetersApprox;
  if (startLat > maxLateral * 2 || endLat > maxLateral * 2) return false;
  /* Midpoint divergence catches "same ends, interstate middle" swaps. */
  const midPt = pointAtAlongMeters(candidate, totalM / 2);
  const lockedMid = pointAtAlongMeters(locked, polylineLengthMeters(locked) / 2);
  if (haversineMeters(midPt, lockedMid) > maxLateral * 3) {
    if (closestPointOnPolyline(midPt, locked).lateralMetersApprox > maxLateral) return false;
  }
  return checks > 0 && hits / checks >= minFrac;
}
