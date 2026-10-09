/**
 * Drive-view navigation: keep the driver on their locked corridor.
 * Lateral leave soft-restarts from GPS→destination (same trip, new lock geometry)
 * so Drive / Route / Map share one ahead line. The driver's choice (fastest or
 * alternate) sticks. The drawn line does not, and an alternate is not a motorway ban.
 *
 * Route / map views keep A/B/C alternates; drive shows only the locked leg.
 *
 * Thresholds are duplicated (not imported from offRouteDetect) so Vite HMR cannot
 * hit a circular partial-export failure for {@link lockedRoutePrefersBackroads}.
 */
import { headingDeltaDegrees } from "./forwardRoutePick";
import { CORE_REROUTE_GRACE_MS } from "./rerouteOwner";
import type { RouteRole } from "./types";

/**
 * Align with non-drive off-route (~18 m) — not ~6 ft GPS noise.
 * (A 2 m enter threshold caused constant silent replans onto the highway.)
 */
export const DRIVE_AHEAD_OFF_ROUTE_ENTER_M = 18;
export const DRIVE_AHEAD_OFF_ROUTE_EXIT_M = 10;
/** Require sustained leave before replan (same as non-drive confirm). */
export const DRIVE_AHEAD_CONFIRM_TICKS = 3;
/** ~3.4 mph — still ignore parked GPS drift. */
export const DRIVE_AHEAD_MIN_SPEED_MPS = 1.5;
export const DRIVE_AHEAD_HEADING_MIN_LATERAL_M = 12;
export const DRIVE_AHEAD_HEADING_DELTA_DEG = 32;
/** Cap Mapbox Directions churn when GPS jitters off the corridor in drive view. */
export const DRIVE_AHEAD_REROUTE_THROTTLE_MS = 8_000;
/**
 * Clearly off the drawn line — about a quarter mile. Past a bridge slip and a
 * missed turn on a highway. Build a new line from here instead of waiting on the old one.
 */
export const DRIVE_REANCHOR_LATERAL_M = 400;
/**
 * City blocks are often 80–120 m. Two agreeing polls, then draw before the next
 * cross street — do not wait out a freeway-length Core grace.
 */
export const DRIVE_AHEAD_CONFIRM_TICKS_CITY = 2;
/** Past a real turn (~90 ft), still short of the next intersection. */
export const DRIVE_REANCHOR_CITY_LATERAL_M = 28;
/** Retry a missed city fetch before the driver reaches the next street. */
export const DRIVE_AHEAD_REROUTE_THROTTLE_CITY_MS = 2_500;
/** Core may already be rerouting. If it has not, plan from here. */
export const CORE_REROUTE_GRACE_CITY_MS = 1_000;
/**
 * A real turn off the drawn line — not a curve or a lane change.
 * Plan forward immediately so the next intersection is still ahead.
 */
export const DRIVE_TURN_OFF_HEADING_DELTA_DEG = 55;
/** ~7 mph. A creep into a lot is not "I took the other road." */
export const DRIVE_TURN_OFF_MIN_SPEED_MPS = 3;
export const DRIVE_TURN_OFF_MIN_LATERAL_M = 12;
/** Two polls agree, then draw. Do not wait for a third sample. */
export const DRIVE_TURN_OFF_CONFIRM_TICKS = 2;
/** Retry a missed forward plan before the next cross street. */
export const DRIVE_TURN_OFF_THROTTLE_MS = 2_000;

/**
 * The car has turned off the locked line and is still moving.
 * That is a new trip from here, in the direction they are facing.
 */
export function driveTurnedOffRoute(input: {
  headingDeg: number | null | undefined;
  routeBearingDeg: number | null | undefined;
  speedMps: number | null | undefined;
  lateralM: number | null | undefined;
}): boolean {
  const heading = input.headingDeg;
  const routeBearing = input.routeBearingDeg;
  const speed = input.speedMps ?? 0;
  const lateral = input.lateralM ?? 0;
  if (heading == null || routeBearing == null) return false;
  if (!Number.isFinite(heading) || !Number.isFinite(routeBearing)) return false;
  if (!(speed >= DRIVE_TURN_OFF_MIN_SPEED_MPS)) return false;
  if (!(lateral >= DRIVE_TURN_OFF_MIN_LATERAL_M)) return false;
  return headingDeltaDegrees(heading, routeBearing) >= DRIVE_TURN_OFF_HEADING_DELTA_DEG;
}

export type DriveReroutePace = {
  confirmTicks: number;
  reanchorLateralM: number;
  throttleMs: number;
  coreGraceMs: number;
};

/** Highway keeps the long wait. City streets must show a line before the next block. */
export function driveReroutePace(roadClass: "highway" | "city_streets" | "unknown" | null | undefined): DriveReroutePace {
  if (roadClass === "city_streets") {
    return {
      confirmTicks: DRIVE_AHEAD_CONFIRM_TICKS_CITY,
      reanchorLateralM: DRIVE_REANCHOR_CITY_LATERAL_M,
      throttleMs: DRIVE_AHEAD_REROUTE_THROTTLE_CITY_MS,
      coreGraceMs: CORE_REROUTE_GRACE_CITY_MS,
    };
  }
  return {
    confirmTicks: DRIVE_AHEAD_CONFIRM_TICKS,
    reanchorLateralM: DRIVE_REANCHOR_LATERAL_M,
    throttleMs: DRIVE_AHEAD_REROUTE_THROTTLE_MS,
    coreGraceMs: CORE_REROUTE_GRACE_MS,
  };
}
/** Short post-Go grace — only block tiny GPS noise at the start pin. */
export const DRIVE_AHEAD_NAV_START_GRACE_MS = 12_000;
export const DRIVE_AHEAD_NAV_START_GRACE_ALONG_M = 120;
export const DRIVE_AHEAD_NAV_START_GRACE_MAX_LATERAL_M = 10;

/** True when the locked Go route should stay off interstates on silent drive replans. */
export function lockedRoutePrefersBackroads(role: RouteRole | undefined | null): boolean {
  return role === "hazardSmart" || role === "balanced";
}

/**
 * Whether silent Core / DIY replans should avoid motorways for this lock.
 * Role-based no-interstate/balanced always qualify. Also true when the driver
 * locked a slower alternate than the plan's fastest leg (preferred trail / area
 * routes often promote that blue preview without changing the role tag).
 */
export function lockedRouteShouldAvoidMotorway(
  locked: { id: string; role?: RouteRole | null; baseEtaMinutes?: number } | null | undefined,
  planRoutes: readonly { id: string; baseEtaMinutes?: number }[]
): boolean {
  if (!locked) return false;
  if (lockedRoutePrefersBackroads(locked.role)) return true;
  if (planRoutes.length < 2) return false;
  /* Main stays Main. A construction detour can make this leg's ETA longer than
   * the other option; that must not flip the rest of the trip onto no-interstate. */
  const primary = planRoutes.find((r) => r.id === "r-a") ?? planRoutes[0]!;
  if (locked.role === "fastest" && locked.id === primary.id) return false;
  let fastestId = planRoutes[0]!.id;
  let fastestEta = planRoutes[0]!.baseEtaMinutes;
  for (const r of planRoutes) {
    const eta = r.baseEtaMinutes;
    if (eta == null || !Number.isFinite(eta)) continue;
    if (fastestEta == null || !Number.isFinite(fastestEta) || eta < fastestEta) {
      fastestEta = eta;
      fastestId = r.id;
    }
  }
  return locked.id !== fastestId;
}

export function isDriveAlwaysAheadView(viewMode: string): boolean {
  return viewMode === "drive";
}

/**
 * Drive + clearly off the corridor: camera and puck follow forward travel, not the old
 * polyline tangent back toward where the driver left the route.
 *
 * `offRouteLatched` tracks distance to the original **locked** corridor and stays true
 * while a temporary rejoin/detour leg is actively steering guidance — that leg has its
 * own valid polyline, so once GPS is on it the camera should use ITS tangent instead of
 * falling back to travel-only framing (which can look sideways until the driver merges
 * back onto the original route and the latch finally clears).
 */
export function isDriveOffRouteForwardFraming(input: {
  driveModeUi: boolean;
  navigationStarted: boolean;
  onRoute: boolean;
  offRouteLatched: boolean;
  /** True while an auto-rejoin/detour leg (not the original locked route) drives guidance. */
  followingTemporaryGuidance?: boolean;
}): boolean {
  if (!input.driveModeUi || !input.navigationStarted) return false;
  if (input.followingTemporaryGuidance) return !input.onRoute;
  return !input.onRoute || input.offRouteLatched;
}
