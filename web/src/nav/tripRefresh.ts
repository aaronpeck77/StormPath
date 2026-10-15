/** What a one-press trip refresh wakes. The destination and Go stay put. */
export type TripRefreshHandlers = {
  resetAlong: () => void;
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
 * Guidance restarts last so the turn banner is cleared and then filled again.
 */
export function runTripRefresh(handlers: TripRefreshHandlers): void {
  handlers.resetAlong();
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
