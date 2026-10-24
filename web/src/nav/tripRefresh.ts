/** What a one-press trip refresh wakes. The destination and Go stay put. */
export type TripRefreshHandlers = {
  resyncCamera: () => void;
  bumpMapFit: () => void;
  refreshTraffic: () => void;
  refreshForecast: () => void;
  restartGuidance: () => void;
};

/** Ignore a second tap while Core is still coming back. */
export const TRIP_REFRESH_COOLDOWN_MS = 4_000;

/**
 * Same recovery as leaving the app and coming back, without dropping the trip.
 * Does not rewind the car to the start of the route. That jumped the turn
 * banner backward, then the live place snapped it forward again.
 */
export function runTripRefresh(handlers: TripRefreshHandlers): void {
  handlers.resyncCamera();
  handlers.bumpMapFit();
  handlers.refreshTraffic();
  handlers.refreshForecast();
  handlers.restartGuidance();
}

export function shouldRunTripRefresh(
  lastAtMs: number | null,
  nowMs: number,
  cooldownMs = TRIP_REFRESH_COOLDOWN_MS
): boolean {
  if (lastAtMs == null) return true;
  return nowMs - lastAtMs >= cooldownMs;
}

/** Drive is where the compass and the turn banner live. */
export function showTripRefreshButton(navigationStarted: boolean, viewMode: string): boolean {
  return navigationStarted && viewMode === "drive";
}
