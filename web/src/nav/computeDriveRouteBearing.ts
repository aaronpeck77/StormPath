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
  /** Meters to the next banner maneuver — stretch look-ahead in the last ~3.4 s. */
  metersToManeuver?: number | null;
};

/** Stay on the approach road until the turn is close. 4.5 s / 140 m always-on cut the corner. */
export const DRIVE_ROUTE_LOOKAHEAD_MIN_M = 36;
export const DRIVE_ROUTE_LOOKAHEAD_MAX_M = 110;
export const DRIVE_ROUTE_LOOKAHEAD_SECONDS = 3.2;
/** Peek past the maneuver so the camera starts rotating before the car does. */
export const DRIVE_ROUTE_STRETCH_SECONDS = 3.4;
export const DRIVE_ROUTE_STRETCH_MIN_M = 55;
export const DRIVE_ROUTE_STRETCH_ADD_SECONDS = 1.6;
export const DRIVE_ROUTE_STRETCH_ADD_MIN_M = 28;
export const DRIVE_ROUTE_STRETCH_CAP_M = 140;

export function driveRouteLookAheadMeters(
  speedMps: number,
  metersToManeuver?: number | null
): number {
  const speed = speedMps > 0 && Number.isFinite(speedMps) ? speedMps : 0;
  let lookAheadM = Math.min(
    DRIVE_ROUTE_LOOKAHEAD_MAX_M,
    Math.max(DRIVE_ROUTE_LOOKAHEAD_MIN_M, DRIVE_ROUTE_LOOKAHEAD_MIN_M + speed * DRIVE_ROUTE_LOOKAHEAD_SECONDS)
  );
  if (
    metersToManeuver != null &&
    Number.isFinite(metersToManeuver) &&
    metersToManeuver >= 0 &&
    metersToManeuver <= Math.max(DRIVE_ROUTE_STRETCH_MIN_M, speed * DRIVE_ROUTE_STRETCH_SECONDS)
  ) {
    lookAheadM = Math.min(
      DRIVE_ROUTE_STRETCH_CAP_M,
      lookAheadM + Math.max(DRIVE_ROUTE_STRETCH_ADD_MIN_M, speed * DRIVE_ROUTE_STRETCH_ADD_SECONDS)
    );
  }
  return lookAheadM;
}

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
  const lookAheadM = driveRouteLookAheadMeters(speed, metersToManeuver);

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
