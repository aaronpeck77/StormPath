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

  const lookAheadM = Math.min(
    155,
    Math.max(42, 42 + (speedMps != null && speedMps > 0 ? speedMps * 4.5 : 0))
  );
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
