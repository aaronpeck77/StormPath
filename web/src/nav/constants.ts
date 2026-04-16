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
/** Strip + “traffic-delay” corridor: show when Mapbox delay is at least this many minutes vs typical. */
export const TRAFFIC_DELAY_ALERT_MINUTES = 2;

/** Minutes of traffic delay for a softer "traffic" card (live estimate required). */
export const TRAFFIC_SOFT_ALERT_MINUTES = 1;

/** Minutes of delay before the traffic alert also prompts reroute. */
export const TRAFFIC_PROMPT_REROUTE_MINUTES = 4;

/** Progress-strip shows a faint traffic pip at this threshold. */
export const TRAFFIC_STRIP_SOFT_MINUTES = 0.5;

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
