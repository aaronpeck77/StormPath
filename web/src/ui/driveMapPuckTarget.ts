import { destinationPointMeters, haversineMeters, initialBearingDegrees } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

export type PuckFix = { lng: number; lat: number; t: number };

/** Max dead-reckoning horizon — caps drift when the next GPS fix is delayed. */
export const PUCK_DEAD_RECKON_MAX_S = 2.5;

/**
 * Interpolate between the last two GPS samples; when the lerp completes, continue at estimated
 * speed so the puck (and follow camera) keep moving smoothly between 1 Hz fixes.
 */
export function computePuckTargetBeforeRouteSnap(input: {
  now: number;
  prevFix: PuckFix | null;
  curFix: PuckFix | null;
  fallback: LngLat;
  speedMps: number | null;
  headingDeg: number | null;
  maxDeadReckonS?: number;
}): LngLat {
  const {
    now,
    prevFix,
    curFix,
    fallback,
    speedMps,
    headingDeg,
    maxDeadReckonS = PUCK_DEAD_RECKON_MAX_S,
  } = input;

  if (prevFix && curFix && curFix.t > prevFix.t) {
    const intervalMs = curFix.t - prevFix.t;
    const alpha = (now - prevFix.t) / intervalMs;
    if (alpha <= 1) {
      return [
        prevFix.lng + (curFix.lng - prevFix.lng) * alpha,
        prevFix.lat + (curFix.lat - prevFix.lat) * alpha,
      ];
    }

    const overshootS = Math.min(maxDeadReckonS, (now - curFix.t) / 1000);
    if (overshootS <= 0) return [curFix.lng, curFix.lat];

    const fixDist = haversineMeters([prevFix.lng, prevFix.lat], [curFix.lng, curFix.lat]);
    const fixSpeed = intervalMs > 0 ? fixDist / (intervalMs / 1000) : null;
    const effSp =
      speedMps != null && speedMps >= 0 ? speedMps : fixSpeed != null && fixSpeed >= 0 ? fixSpeed : null;
    if (effSp == null || effSp < 0.7) return [curFix.lng, curFix.lat];

    const bearing =
      headingDeg != null && Number.isFinite(headingDeg)
        ? headingDeg
        : initialBearingDegrees([prevFix.lng, prevFix.lat], [curFix.lng, curFix.lat]);
    return destinationPointMeters(curFix.lng, curFix.lat, bearing, effSp * overshootS);
  }

  if (curFix) return [curFix.lng, curFix.lat];
  return fallback;
}
