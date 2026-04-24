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

/** Radar intensity that triggers a "heavy weather" alert. */
export const RADAR_HEAVY_THRESHOLD = 0.72;

/** Radar intensity for a softer weather-headline card. */
export const RADAR_SOFT_THRESHOLD = 0.35;

/** Radar at/above this value enables promptRerouteAhead on weather headline. */
export const RADAR_REROUTE_THRESHOLD = 0.5;

/** Drive-ahead banner: scan window ahead of the user (meters). */
export const DRIVE_AHEAD_WINDOW_M = 5 * METERS_PER_MILE;

/** Max alert cards on the progress strip. */
export const MAX_STRIP_ALERTS = 10;

/** Delay minutes for the bypass-offer "heavy corridor" fallback. */
export const BYPASS_HEAVY_DELAY_MINUTES = 15;

/** Severity floor for drive-ahead banner + auto hazard overview. */
export const SERIOUS_DRIVE_AHEAD_MIN_SEVERITY = 72;

/*
 * ── Arrival auto-clear (idle at destination) ─────────────────────────
 */

/** GPS within this distance of the destination counts as “arrived” for auto end-trip. */
export const ARRIVAL_DEST_RADIUS_M = 58;
/** Ground speed below this (m/s) while near the destination counts as stationary (~3.4 mph). */
export const ARRIVAL_STATIONARY_MAX_SPEED_MPS = 1.55;
/** At destination + stationary + no interaction for this long → clear trip (foreground timer). */
export const ARRIVAL_IDLE_CLEAR_MS = 120_000;
/** Tab/phone backgrounded at least this long; on next visible, still near dest → clear trip. */
export const ARRIVAL_BG_CLEAR_MIN_MS = 60_000;
