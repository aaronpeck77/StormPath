import {
  buildCumulativeDistances,
  closestAlongRouteMeters,
  closestPointOnPolylineWindowed,
} from "./routeGeometry";
import type { LngLat } from "./types";

/** Lateral leave before off-route UI (~65 ft moving; wider when stopped — GPS drift). */
export const OFF_ROUTE_REROUTE_ENTER_M = 18;
/** When stopped or crawling, GPS fix can sit 30–40 m off the polyline without leaving the road. */
export const OFF_ROUTE_REROUTE_ENTER_STATIONARY_M = 38;
/** Hysteresis so brief GPS noise does not flip-flop reroutes. */
export const OFF_ROUTE_REROUTE_EXIT_M = 10;
/** Minimum spacing between silent auto-reroute attempts. */
export const OFF_ROUTE_REROUTE_THROTTLE_MS = 1200;
/** Poll interval while navigating (reads latest GPS ref, not only React state ticks). */
export const OFF_ROUTE_POLL_MS = 750;

const WINDOW_BACK_M = 600;
const WINDOW_AHEAD_M = 3_500;

/** When moving, heading must differ from the route this much to trigger at low lateral offset. */
const OFF_ROUTE_HEADING_DELTA_DEG = 38;
/** Minimum lateral offset (m) before heading mismatch can trigger reroute. */
const OFF_ROUTE_HEADING_MIN_LATERAL_M = 2;
/** Minimum speed (m/s) before heading mismatch is considered (~7 mph). */
export const OFF_ROUTE_HEADING_MIN_SPEED_MPS = 3;

/** After Go, ignore off-route until the driver moves or grace expires (GPS vs snap mismatch). */
export const OFF_ROUTE_NAV_START_GRACE_MS = 50_000;
export const OFF_ROUTE_NAV_START_GRACE_ALONG_M = 120;

function effectiveEnterThresholdM(speedMps: number): number {
  return speedMps >= OFF_ROUTE_HEADING_MIN_SPEED_MPS
    ? OFF_ROUTE_REROUTE_ENTER_M
    : OFF_ROUTE_REROUTE_ENTER_STATIONARY_M;
}

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
  const speed = ctx?.speedMps ?? 0;
  const enterM = effectiveEnterThresholdM(speed);
  if (lateralM > enterM) return true;

  const heading = ctx?.headingDeg;
  const routeBearing = ctx?.routeBearingDeg;
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
