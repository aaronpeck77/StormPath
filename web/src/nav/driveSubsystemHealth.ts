/**
 * Phone supervisor audits for Drive subsystems that a soft-reset (home + reopen)
 * already unsticks. Keep recoveries listed — do not invent new ones on device.
 */

export const DRIVE_LOOP_STALL_WINDOW_MS = 8_000;
export const DRIVE_LOOP_STALL_GPS_M = 40;
export const DRIVE_LOOP_STALL_ALONG_M = 8;
export const OFF_ROUTE_REROUTE_HANG_MS = 20_000;
export const OFF_ROUTE_SAMPLE_STALE_MS = 12_000;

export function isDriveLoopStalled(input: {
  navigationStarted: boolean;
  windowMs: number;
  gpsMovedM: number;
  alongMovedM: number;
  /** Off-route: GPS moves, along-track does not — that is healthy, not a frozen Drive. */
  offRouteLatched?: boolean;
}): boolean {
  if (!input.navigationStarted) return false;
  if (input.offRouteLatched) return false;
  if (input.windowMs < DRIVE_LOOP_STALL_WINDOW_MS) return false;
  if (input.gpsMovedM < DRIVE_LOOP_STALL_GPS_M) return false;
  return input.alongMovedM < DRIVE_LOOP_STALL_ALONG_M;
}

export function isOffRouteSubsystemHung(input: {
  navigationStarted: boolean;
  offRouteLatched: boolean;
  rerouteInFlightMs: number | null;
  lastSampleAgeMs: number | null;
}): boolean {
  if (!input.navigationStarted || !input.offRouteLatched) return false;
  /* In-flight fetch: only the 20s timeout. Stale-sample hang must not abort a live reroute. */
  if (input.rerouteInFlightMs != null) {
    return input.rerouteInFlightMs >= OFF_ROUTE_REROUTE_HANG_MS;
  }
  if (input.lastSampleAgeMs != null && input.lastSampleAgeMs >= OFF_ROUTE_SAMPLE_STALE_MS) {
    return true;
  }
  return false;
}
