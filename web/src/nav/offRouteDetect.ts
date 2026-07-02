import {
  buildCumulativeDistances,
  closestAlongRouteMeters,
  closestPointOnPolylineWindowed,
} from "./routeGeometry";
import type { LngLat } from "./types";

/** Lateral leave before off-route UI (~65 ft) once the driver is actually moving. */
export const OFF_ROUTE_REROUTE_ENTER_M = 18;
/** Hysteresis so brief GPS noise does not flip-flop reroutes. */
export const OFF_ROUTE_REROUTE_EXIT_M = 10;
/** Minimum spacing between silent auto-reroute attempts. */
export const OFF_ROUTE_REROUTE_THROTTLE_MS = 1200;
/** Poll interval while navigating (reads latest GPS ref, not only React state ticks). */
export const OFF_ROUTE_POLL_MS = 750;

const WINDOW_BACK_M = 600;
const WINDOW_AHEAD_M = 3_500;

/** When moving, heading must differ from the route this much to trigger at low lateral offset. */
export const OFF_ROUTE_HEADING_DELTA_DEG = 38;
/** Minimum lateral offset (m) before heading mismatch can trigger reroute. */
export const OFF_ROUTE_HEADING_MIN_LATERAL_M = 28;
/** Minimum speed (m/s) before off-route can latch (~7 mph). Ignores GPS drift while parked. */
export const OFF_ROUTE_HEADING_MIN_SPEED_MPS = 3;
/** Consecutive poll ticks that must agree before showing rejoin alternates. */
export const OFF_ROUTE_CONFIRM_TICKS = 3;
/** After returning on-route, wait before offering alternates again (unless far off). */
export const OFF_ROUTE_REOFFER_COOLDOWN_MS = 90_000;
/** During cooldown, a clear corridor leave can still trigger immediately. */
export const OFF_ROUTE_FORCE_REOFFER_LATERAL_M = 32;

/** After Go, ignore off-route until the driver has progressed or grace expires. */
export const OFF_ROUTE_NAV_START_GRACE_MS = 120_000;
export const OFF_ROUTE_NAV_START_GRACE_ALONG_M = 800;
/** During grace, only latch when clearly off the chosen corridor (not GPS noise). */
export const OFF_ROUTE_NAV_START_GRACE_MAX_LATERAL_M = 45;

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
  /** Step-aware enter threshold; defaults to {@link OFF_ROUTE_REROUTE_ENTER_M}. */
  enterThresholdM?: number;
  /** Override movement floor (drive-ahead uses a lower threshold). */
  minSpeedMps?: number;
  headingMinLateralM?: number;
  headingDeltaDeg?: number;
};

/**
 * Lateral distance to the active route near where the driver was last trusted on-line.
 * Windowed search avoids matching a geographically close but far-ahead segment on long routes.
 */
export function measureOffRouteLateral(
  user: LngLat,
  geometry: LngLat[],
  alongHintM: number,
  cumDistHint?: Float64Array | null
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

  const cumDist =
    cumDistHint && cumDistHint.length === geometry.length
      ? cumDistHint
      : buildCumulativeDistances(geometry);
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
 * Off-route requires driving — lateral distance alone never latches while stopped (home GPS drift).
 * When moving: leave the corridor, or drive on a different bearing than the route ahead.
 */
export function shouldTriggerOffRouteReroute(
  sample: OffRouteSample | number,
  ctx?: OffRouteTriggerContext
): boolean {
  const lateralM = typeof sample === "number" ? sample : sample.lateralM;
  const fullScanLateralM =
    typeof sample === "number" ? lateralM : sample.fullScanLateralM;
  /** Windowed search can under-report at forks; full scan catches parallel/wrong-leg matches. */
  const corridorLeaveM = Math.max(lateralM, fullScanLateralM);
  const minSpeed = ctx?.minSpeedMps ?? OFF_ROUTE_HEADING_MIN_SPEED_MPS;
  const speed = ctx?.speedMps ?? 0;
  if (speed < minSpeed) return false;

  const enterM = ctx?.enterThresholdM ?? OFF_ROUTE_REROUTE_ENTER_M;
  if (corridorLeaveM > enterM) return true;

  const heading = ctx?.headingDeg;
  const routeBearing = ctx?.routeBearingDeg;
  const headingMinLateral = ctx?.headingMinLateralM ?? OFF_ROUTE_HEADING_MIN_LATERAL_M;
  const headingDelta = ctx?.headingDeltaDeg ?? OFF_ROUTE_HEADING_DELTA_DEG;
  if (
    heading != null &&
    routeBearing != null &&
    Number.isFinite(heading) &&
    Number.isFinite(routeBearing) &&
    corridorLeaveM >= headingMinLateral &&
    headingDeltaDegrees(heading, routeBearing) >= headingDelta
  ) {
    return true;
  }
  return false;
}

/** True when a new rejoin offer is allowed (respects post-on-route cooldown). */
export function shouldOfferOffRouteRejoin(
  lateralM: number,
  reofferBlockedUntilMs: number,
  nowMs: number = Date.now()
): boolean {
  if (nowMs >= reofferBlockedUntilMs) return true;
  return lateralM >= OFF_ROUTE_FORCE_REOFFER_LATERAL_M;
}

export function shouldExitOffRouteLatch(lateralM: number): boolean {
  return lateralM < OFF_ROUTE_REROUTE_EXIT_M;
}
