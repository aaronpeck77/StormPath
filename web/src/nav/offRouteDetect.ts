import {
  buildCumulativeDistances,
  closestAlongRouteMeters,
  closestPointOnPolylineWindowed,
} from "./routeGeometry";
import type { LngLat } from "./types";

/** ~100 ft — reroute when this far from the corridor near your last on-route position. */
export const OFF_ROUTE_REROUTE_ENTER_M = 30;
/** Hysteresis so brief GPS noise does not flip-flop reroutes. */
export const OFF_ROUTE_REROUTE_EXIT_M = 15;
/** Minimum spacing between silent auto-reroute attempts. */
export const OFF_ROUTE_REROUTE_THROTTLE_MS = 700;
/** Poll interval while navigating (reads latest GPS ref, not only React state ticks). */
export const OFF_ROUTE_POLL_MS = 450;

const WINDOW_BACK_M = 600;
const WINDOW_AHEAD_M = 3_500;

export type OffRouteSample = {
  lateralM: number;
  alongM: number;
  /** Full-polyline lateral — used to detect false “on route” from a far-ahead parallel match. */
  fullScanLateralM: number;
};

/**
 * Lateral distance to the active route near where the driver was last trusted on-line.
 * Windowed search avoids matching a geographically close but far-ahead segment on long routes.
 */
export function measureOffRouteLateral(
  user: LngLat,
  geometry: LngLat[],
  alongHintM: number
): OffRouteSample {
  if (geometry.length < 2) {
    const full = closestAlongRouteMeters(user, geometry);
    return {
      lateralM: full.lateralMetersApprox,
      alongM: full.alongMeters,
      fullScanLateralM: full.lateralMetersApprox,
    };
  }

  const full = closestAlongRouteMeters(user, geometry);
  if (!(alongHintM > 0)) {
    return {
      lateralM: full.lateralMetersApprox,
      alongM: full.alongMeters,
      fullScanLateralM: full.lateralMetersApprox,
    };
  }

  const cumDist = buildCumulativeDistances(geometry);
  const windowed = closestPointOnPolylineWindowed(
    user,
    geometry,
    cumDist,
    alongHintM,
    WINDOW_BACK_M,
    WINDOW_AHEAD_M
  );

  return {
    lateralM: windowed.lateralMetersApprox,
    alongM: windowed.alongMeters,
    fullScanLateralM: full.lateralMetersApprox,
  };
}

export function shouldTriggerOffRouteReroute(lateralM: number): boolean {
  return lateralM > OFF_ROUTE_REROUTE_ENTER_M;
}

export function shouldExitOffRouteLatch(lateralM: number): boolean {
  return lateralM < OFF_ROUTE_REROUTE_EXIT_M;
}
