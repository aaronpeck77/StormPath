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
}): boolean {
  if (!input.navigationStarted) return false;
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
  if (input.rerouteInFlightMs != null && input.rerouteInFlightMs >= OFF_ROUTE_REROUTE_HANG_MS) {
    return true;
  }
  if (input.lastSampleAgeMs != null && input.lastSampleAgeMs >= OFF_ROUTE_SAMPLE_STALE_MS) {
    return true;
  }
  return false;
}
