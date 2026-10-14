/** What a one-press trip refresh wakes. The destination and Go stay put. */
export type TripRefreshHandlers = {
  resetAlong: () => void;
  resyncCamera: () => void;
  refreshTraffic: () => void;
  refreshForecast: () => void;
  restartGuidance: () => void;
};

/**
 * Same recovery as leaving the app and coming back, without dropping the trip.
 * Guidance restarts last so the turn banner is cleared and then filled again.
 */
export function runTripRefresh(handlers: TripRefreshHandlers): void {
  handlers.resetAlong();
  handlers.resyncCamera();
  handlers.refreshTraffic();
  handlers.refreshForecast();
  handlers.restartGuidance();
}

/** Drive is where the compass and the turn banner live. */
export function showTripRefreshButton(navigationStarted: boolean, viewMode: string): boolean {
  return navigationStarted && viewMode === "drive";
}
