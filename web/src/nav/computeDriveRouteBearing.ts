import {
  bearingAlongRouteAhead,
  haversineMeters,
  initialBearingDegrees,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./routeGeometry";
import type { LngLat } from "./types";

export type ComputeDriveRouteBearingInput = {
  driveOffRouteForwardFraming: boolean;
  driveModeUi: boolean;
  effectiveUserLngLat: LngLat | null | undefined;
  geometry: LngLat[] | null | undefined;
  speedMps: number | null | undefined;
  navigationStarted: boolean;
  userAlongGuidanceM: number;
  /** Meters to the next banner maneuver — near-turn bump so the cam swings a little early. */
  metersToManeuver?: number | null;
};

/**
 * Drive camera bearing: polyline ahead on-corridor; falls back to live closest-point
 * tangent when the puck is far from the held progress anchor.
 */
export function computeDriveRouteBearing(input: ComputeDriveRouteBearingInput): number | null {
  const {
    driveOffRouteForwardFraming,
    driveModeUi,
    effectiveUserLngLat,
    geometry,
    speedMps,
    navigationStarted,
    userAlongGuidanceM,
    metersToManeuver = null,
  } = input;

  if (
    driveOffRouteForwardFraming ||
    !driveModeUi ||
    !effectiveUserLngLat ||
    !geometry ||
    geometry.length < 2
  ) {
    return null;
  }

  const speed = speedMps != null && speedMps > 0 ? speedMps : 0;
  /* Mild turn anticipation: look farther down the corridor (~4.5 s of travel). */
  let lookAheadM = Math.min(140, Math.max(40, 40 + speed * 4.5));
  /* Within ~2–3 s of the next turn, stretch past the maneuver so the chord includes post-turn heading. */
  if (
    metersToManeuver != null &&
    Number.isFinite(metersToManeuver) &&
    metersToManeuver >= 0 &&
    metersToManeuver <= Math.max(60, speed * 3)
  ) {
    lookAheadM = Math.min(180, lookAheadM + Math.max(40, speed * 2));
  }

  const OFF_ROUTE_FOR_CAMERA_TANGENT_M = 168;
  const totalM = polylineLengthMeters(geometry);
  let b: number | null = null;

  if (navigationStarted && Number.isFinite(userAlongGuidanceM) && totalM > 1) {
    const fromAlongM = Math.max(0, Math.min(totalM, userAlongGuidanceM));
    const heldAnchor = pointAtAlongMeters(geometry, fromAlongM);
    const distToHeld = haversineMeters(effectiveUserLngLat, heldAnchor);
    if (distToHeld <= OFF_ROUTE_FOR_CAMERA_TANGENT_M) {
      const toAlongM = Math.min(totalM, fromAlongM + lookAheadM);
      const fromPt = pointAtAlongMeters(geometry, fromAlongM);
      const toPt = pointAtAlongMeters(geometry, Math.max(toAlongM, fromAlongM + 0.5));
      if (haversineMeters(fromPt, toPt) >= 2.5) {
        b = initialBearingDegrees(fromPt, toPt);
      }
    }
  }
  if (b == null) {
    b = bearingAlongRouteAhead(effectiveUserLngLat, geometry, lookAheadM);
  }
  return b;
}
