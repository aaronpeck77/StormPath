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

/**
 * Whether to install Core / soft-restart geometry onto the Go lock.
 * Mid-trip reroutes pass `force`. Session-start Core "fastest" without force is
 * rejected when it diverges from the corridor the driver locked at Go.
 */
/**
 * Mid-trip Core reroute from the driver's GPS (left the Go lock).
 * Session-start "fastest" steal starts on the locked corridor — this must stay false then.
 */
export const OFF_ROUTE_NATIVE_USER_LATERAL_M = 40;
export const OFF_ROUTE_NATIVE_START_NEAR_USER_M = 150;

export function shouldForceAdoptOffRouteNativeGeometry(input: {
  candidate: LngLat[];
  locked: LngLat[] | null | undefined;
  userLngLat: LngLat | null | undefined;
}): boolean {
  const { candidate, locked, userLngLat } = input;
  if (!userLngLat || !locked || locked.length < 2 || candidate.length < 2) return false;
  const userToLocked = closestPointOnPolyline(userLngLat, locked).lateralMetersApprox;
  if (userToLocked < OFF_ROUTE_NATIVE_USER_LATERAL_M) return false;
  return haversineMeters(candidate[0]!, userLngLat) < OFF_ROUTE_NATIVE_START_NEAR_USER_M;
}

/**
 * Apple 4.20.7 (`4ecb648`) always force-adopted Core `routeChanged`.
 * Session-start still must not steal Go-locked B; every later Core reroute
 * (off-route) is the new lock — same as that submitted IPA.
 */
export function nativeRouteChangedShouldForce(input: {
  isFirstRouteChanged: boolean;
  driverAlreadyOffLockedCorridor: boolean;
}): boolean {
  if (!input.isFirstRouteChanged) return true;
  return input.driverAlreadyOffLockedCorridor;
}

export function shouldAdoptNativeRouteGeometry(
  candidate: LngLat[],
  lockedGoGeometry: LngLat[] | null | undefined,
  force: boolean
): boolean {
  if (candidate.length < 2) return false;
  if (force) return true;
  if (!lockedGoGeometry || lockedGoGeometry.length < 2) return true;
  return routeGeometryAgreesWithLocked(candidate, lockedGoGeometry);
}

/**
 * Session-start Core `routeChanged` (even an agreeing refine) used to:
 * - bump along-hold → puck jumps back to 0 then leaps forward
 * - collapse A/B/C to one slot → chosen B relabels as A
 * Only a true mid-trip force (off-route / explicit promote) may do those.
 */
export function nativeGeometryApplyPolicy(force: boolean): {
  resetAlongHold: boolean;
  collapsePlanToLocked: boolean;
} {
  if (force) {
    return { resetAlongHold: true, collapsePlanToLocked: true };
  }
  return { resetAlongHold: false, collapsePlanToLocked: false };
}

/** Session-start Core refine must not replace the Go polyline (puck/along reset). */
export function shouldReplaceGoPolylineOnNativeAdopt(
  force: boolean,
  hasLockedGoGeometry: boolean
): boolean {
  return force || !hasLockedGoGeometry;
}

/**
 * True when Core progress may drive the puck / alongM.
 * Rejected session-start geometry must not feed UI — Core's fastest line vs the
 * Go lock is what made the puck leap forward and back.
 */
export function shouldFeedNativeProgressToUi(input: {
  abandoned: boolean;
  corridorAdopted: boolean;
}): boolean {
  return input.corridorAdopted && !input.abandoned;
}
