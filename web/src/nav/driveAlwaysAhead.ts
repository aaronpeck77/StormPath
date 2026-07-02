/**
 * Drive-view navigation: the active road is always the main route.
 * Any lateral leave triggers an immediate GPS→destination replan constrained to
 * forward heading so the polyline stays in front of the driver.
 *
 * Route / map views keep A/B/C alternates; drive shows only the locked leg.
 * Replans use Mapbox driving-traffic fastest (no motorway exclusion), constrained
 * to the driver's heading with forward-first scoring (no immediate U-turn).
 */

/** ~6 ft lateral leave before replan while moving in drive view. */
export const DRIVE_AHEAD_OFF_ROUTE_ENTER_M = 2;
export const DRIVE_AHEAD_OFF_ROUTE_EXIT_M = 1.5;
/** One poll tick — no multi-second observation window in drive. */
export const DRIVE_AHEAD_CONFIRM_TICKS = 1;
/** ~3.4 mph — still ignore parked GPS drift. */
export const DRIVE_AHEAD_MIN_SPEED_MPS = 1.5;
export const DRIVE_AHEAD_HEADING_MIN_LATERAL_M = 3;
export const DRIVE_AHEAD_HEADING_DELTA_DEG = 28;
export const DRIVE_AHEAD_REROUTE_THROTTLE_MS = 900;
/** Short post-Go grace — only block tiny GPS noise at the start pin. */
export const DRIVE_AHEAD_NAV_START_GRACE_MS = 12_000;
export const DRIVE_AHEAD_NAV_START_GRACE_ALONG_M = 120;
export const DRIVE_AHEAD_NAV_START_GRACE_MAX_LATERAL_M = 10;

export function isDriveAlwaysAheadView(viewMode: string): boolean {
  return viewMode === "drive";
}

/**
 * Drive + off the corridor: camera and puck follow forward travel, not the old polyline
 * tangent back toward where the driver left the route.
 */
export function isDriveOffRouteForwardFraming(input: {
  driveModeUi: boolean;
  navigationStarted: boolean;
  onRoute: boolean;
  offRouteLatched: boolean;
}): boolean {
  return (
    input.driveModeUi &&
    input.navigationStarted &&
    (!input.onRoute || input.offRouteLatched)
  );
}
