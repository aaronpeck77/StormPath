import type { LngLat } from "./types";

/** Meters per statute mile. */
export const METERS_PER_MILE = 1_609.34;

/** Geographic center of the contiguous US — used when no geometry or user position is available. */
export const FALLBACK_LNGLAT: LngLat = [-98.5, 39.8];

/** Saved-route ETA uses this fixed average when no live traffic is available (km/h). */
export const SAVED_ROUTE_AVG_KMH = 45;

/*
 * ── Alert thresholds ─────────────────────────────────────────────────
 * Tuning knobs for `routeAlerts`, `driveAheadPick`, and `trafficBypassOffer`.
 * Centralised here so they can be adjusted in one place.
 */

/** Minutes of traffic delay before surfacing a full "delay" alert card. */
/** Strip + "traffic-delay" corridor: show only for serious delay vs typical. */
export const TRAFFIC_DELAY_ALERT_MINUTES = 10;

/** Minutes of traffic delay for a softer "traffic" card (live estimate required). */
export const TRAFFIC_SOFT_ALERT_MINUTES = 8;

/** Minutes of delay before the traffic alert also prompts reroute. */
export const TRAFFIC_PROMPT_REROUTE_MINUTES = 10;

/** Progress-strip shows a faint traffic pip at this threshold. */
export const TRAFFIC_STRIP_SOFT_MINUTES = 8;

/**
 * Traffic / hazard bypass — A/B/C compare from GPS, then explicit confirm to switch the locked route.
 * Off while core navigation (off-route auto-reroute) is hardened.
 */
export const TRAFFIC_BYPASS_ENABLED = false;

/**
 * Off-route manual choice UI ("Stay on this road" / "Return to original route").
 * When false, {@link useOffRouteNavigation} auto-recalculates from GPS when off-route is detected.
 */
export const MANUAL_OFF_ROUTE_CHOICES_ENABLED = false;

/**
 * Off-route auto-reroute from GPS (gas stop, missed turn) without driver prompts.
 * Active when manual choice UI is off; otherwise follows the user's Auto detour setting.
 */
export function isAutoOffRouteRerouteActive(userAutoRerouteSetting: boolean): boolean {
  if (!MANUAL_OFF_ROUTE_CHOICES_ENABLED) return true;
  return userAutoRerouteSetting;
}

/** Manual off-route banner + Stay / Return buttons in {@link BottomToolbar}. */
export function shouldShowManualOffRouteUi(): boolean {
  return MANUAL_OFF_ROUTE_CHOICES_ENABLED;
}

/** Traffic bypass chip, compare panel, and hazard approach reroute CTAs. */
export function shouldShowTrafficBypassUi(): boolean {
  return TRAFFIC_BYPASS_ENABLED;
}

/** @deprecated Use {@link TRAFFIC_BYPASS_ENABLED} — auto reroute is controlled by the user setting. */
export const LIVE_REROUTE_ENABLED = TRAFFIC_BYPASS_ENABLED;

/**
 * Relative threshold: any delay ≥ this fraction of remaining trip time is
 * treated as significant, even if it's below the absolute minute floor.
 * Example: a +6 min delay on a 25 min commute = 24 % → fires; same delay on a
 * 5 hr trip = 2 % → ignored. Use `isSignificantTrafficDelay` below.
 */
export const TRAFFIC_DELAY_RELATIVE_FRACTION = 0.15;

/** Below this remaining-trip duration the relative-fraction rule is skipped (avoids "0.5 min on a 1 min trip" noise). */
export const TRAFFIC_DELAY_RELATIVE_MIN_REMAINING_MIN = 8;

/**
 * Returns true when a traffic delay (in minutes) is significant relative to the
 * remaining trip duration. Delay is "significant" if EITHER:
 *  - it exceeds the absolute minute floor, OR
 *  - it exceeds `TRAFFIC_DELAY_RELATIVE_FRACTION` of the remaining trip time
 *    (and the trip is long enough to make the ratio meaningful).
 */
export function isSignificantTrafficDelay(
  delayMin: number,
  remainingMin: number | null | undefined,
  absoluteFloor: number = TRAFFIC_DELAY_ALERT_MINUTES,
): boolean {
  if (!Number.isFinite(delayMin) || delayMin <= 0) return false;
  if (delayMin >= absoluteFloor) return true;
  if (
    remainingMin != null &&
    Number.isFinite(remainingMin) &&
    remainingMin >= TRAFFIC_DELAY_RELATIVE_MIN_REMAINING_MIN
  ) {
    return delayMin >= remainingMin * TRAFFIC_DELAY_RELATIVE_FRACTION;
  }
  return false;
}

/** Radar intensity that triggers a "heavy weather" alert (storm-core reflectivity). */
export const RADAR_HEAVY_THRESHOLD = 0.64; // dialed up — mid yellow/green should not read as heavy

/** Radar intensity for a softer “trace showers” band on the progress strip / timeline. */
export const RADAR_SOFT_THRESHOLD = 0.26;

/** Radar at/above this value suggests slowing / preparing (solid moderate rain). */
export const RADAR_REROUTE_THRESHOLD = 0.48;

/** Storm-core / very heavy echo — maps to serious severity. */
export const RADAR_VERY_HEAVY_THRESHOLD = 0.8;

/** Drive-ahead banner: scan window ahead of the user (meters). */
export const DRIVE_AHEAD_WINDOW_M = 5 * METERS_PER_MILE;

/**
 * Full polygon intersection + map highlights for weather within this window ahead of the user.
 * Distant route weather still appears on the timeline via coarse placement.
 */
export const WEATHER_DETAIL_AHEAD_M = 80 * METERS_PER_MILE;

/** While navigating, keep a short behind window for bands you're leaving. */
export const WEATHER_DETAIL_BEHIND_M = 15 * METERS_PER_MILE;

/** While planning, precise band geometry only for weather near the departure end of the trip. */
export const WEATHER_PLANNING_DETAIL_AHEAD_M = 120 * METERS_PER_MILE;

/** Max alert cards on the progress strip. */
export const MAX_STRIP_ALERTS = 10;

/** Delay minutes for the bypass-offer "heavy corridor" fallback. */
export const BYPASS_HEAVY_DELAY_MINUTES = 15;

/** Severity floor for drive-ahead banner + auto hazard overview. */
export const SERIOUS_DRIVE_AHEAD_MIN_SEVERITY = 72;

/*
 * ── Arrival auto-clear (idle at destination) ─────────────────────────
 */

/** GPS within this distance of the destination pin counts as “arrived” (GPS error is often 15–65 m). */
export const ARRIVAL_DEST_RADIUS_M = 140;
/** Along-route remaining below this counts as arrived even if the pin is farther (parking, building offset). */
export const ARRIVAL_ROUTE_REMAINING_M = 100;
/** Near the last point on the driven polyline (road snap vs search pin). */
export const ARRIVAL_ROUTE_END_RADIUS_M = 130;
/** Ground speed below this (m/s) while near the destination counts as stationary (~6.3 mph). */
export const ARRIVAL_STATIONARY_MAX_SPEED_MPS = 2.8;
/** Default idle at destination before auto end-trip (foreground timer). */
export const ARRIVAL_IDLE_CLEAR_MS = 75_000;
/** Shorter idle when almost no distance remains along the route. */
export const ARRIVAL_IDLE_CLEAR_NEAR_MS = 50_000;
export const ARRIVAL_IDLE_CLEAR_VERY_NEAR_MS = 30_000;
/** Along-route remaining at or below this — missing GPS speed may still count as stopped (parked at pin). */
export const ARRIVAL_STATIONARY_UNKNOWN_SPEED_MAX_REMAINING_M = 35;
/** Tab/phone backgrounded at least this long before pausing arrival checks on resume (GPS re-acquire). */
export const ARRIVAL_BG_CLEAR_MIN_MS = 45_000;
/** After a long background, skip arrival auto-clear until GPS/speed restabilize. */
export const ARRIVAL_BG_RESUME_GRACE_MS = 12_000;
