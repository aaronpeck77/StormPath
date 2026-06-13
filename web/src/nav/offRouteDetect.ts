import {
  buildCumulativeDistances,
  closestAlongRouteMeters,
  closestPointOnPolylineWindowed,
} from "./routeGeometry";
import type { LngLat } from "./types";

/** ~10 ft — assume a parallel/different line once you leave the corridor this far. */
export const OFF_ROUTE_REROUTE_ENTER_M = 3;
/** Hysteresis so brief GPS noise does not flip-flop reroutes. */
export const OFF_ROUTE_REROUTE_EXIT_M = 1.5;
/** Minimum spacing between silent auto-reroute attempts. */
export const OFF_ROUTE_REROUTE_THROTTLE_MS = 400;
/** Poll interval while navigating (reads latest GPS ref, not only React state ticks). */
export const OFF_ROUTE_POLL_MS = 400;

const WINDOW_BACK_M = 600;
const WINDOW_AHEAD_M = 3_500;

/** When moving, heading must differ from the route this much to trigger at low lateral offset. */
const OFF_ROUTE_HEADING_DELTA_DEG = 22;
/** Minimum lateral offset (m) before heading mismatch can trigger reroute. */
const OFF_ROUTE_HEADING_MIN_LATERAL_M = 0.35;
/** Minimum speed (m/s) before heading mismatch is considered (~4.5 mph). */
const OFF_ROUTE_HEADING_MIN_SPEED_MPS = 2;

export type OffRouteSample = {
  lateralM: number;
  alongM: number;
  /** Full-polyline lateral — used to detect false “on route” from a far-ahead parallel match. */
  fullScanLateralM: number;
};

export type OffRouteTriggerContext = {
  headingDeg?: number | null;
  speedMps?: number | null;
  routeBearingDeg?: number | null;
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

function headingDeltaDegrees(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Plus auto-reroute: leave the corridor quickly, or stay on a different line (heading mismatch)
 * even when GPS lateral error is tiny.
 */
export function shouldTriggerOffRouteReroute(
  sample: OffRouteSample | number,
  ctx?: OffRouteTriggerContext
): boolean {
  const lateralM = typeof sample === "number" ? sample : sample.lateralM;
  if (lateralM > OFF_ROUTE_REROUTE_ENTER_M) return true;

  const heading = ctx?.headingDeg;
  const routeBearing = ctx?.routeBearingDeg;
  const speed = ctx?.speedMps ?? 0;
  if (
    speed >= OFF_ROUTE_HEADING_MIN_SPEED_MPS &&
    heading != null &&
    routeBearing != null &&
    Number.isFinite(heading) &&
    Number.isFinite(routeBearing) &&
    lateralM >= OFF_ROUTE_HEADING_MIN_LATERAL_M &&
    headingDeltaDegrees(heading, routeBearing) >= OFF_ROUTE_HEADING_DELTA_DEG
  ) {
    return true;
  }
  return false;
}

export function shouldExitOffRouteLatch(lateralM: number): boolean {
  return lateralM < OFF_ROUTE_REROUTE_EXIT_M;
}
