/**
 * Drive-view navigation: keep the driver on their locked corridor.
 * Lateral leave triggers replan from GPS→destination; when the locked leg is a
 * no-interstate / alternate choice, replans keep `preferBackroads` so Mapbox does
 * not yank the driver onto the highway “fastest” path.
 *
 * Route / map views keep A/B/C alternates; drive shows only the locked leg.
 *
 * Thresholds are duplicated (not imported from offRouteDetect) so Vite HMR cannot
 * hit a circular partial-export failure for {@link lockedRoutePrefersBackroads}.
 */
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
