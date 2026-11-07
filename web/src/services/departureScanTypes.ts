/**
 * Departure-scan shared types — provider-agnostic hourly weather series kept
 * per corridor location so departure-time shifts can be scored against the
 * full forecast window (unlike {@link RouteForecast}, which collapses hours
 * into per-waypoint ETA samples).
 */

/** One hourly forecast sample at a scan location, indexed by absolute offset. */
export type DepartureScanHour = {
  /** Minutes from the fetch timestamp (0 ≈ now). */
  offsetMin: number;
  /** Tomorrow.io-style weatherCode integer (WeatherKit codes are mapped). */
  weatherCode: number;
  /** mm/hr */
  precipIntensityMmh: number;
  /** 0–1 */
  precipProbability: number;
  /** mph */
  windGustMph: number;
  /** mm of standing water on road surface, when the provider supplies it. */
  wetRoadMm?: number;
};

/** Hourly series at one corridor fetch point (or the whole-route polyline). */
export type DepartureScanLocation = {
  /** Stable key — `routeForecastLocationKey` or `"route"` for polyline averages. */
  key: string;
  lat: number;
  lng: number;
  /** Sorted ascending by `offsetMin`. */
  hours: DepartureScanHour[];
};

/** A sample point along the route; `travelMin` = minutes from origin at plan speed/ETA. */
export type DepartureScanWaypoint = {
  lat: number;
  lng: number;
  travelMin: number;
};

/** How far past "leave now" the scan evaluates (6 h covers most storm passages). */
export const DEPARTURE_SCAN_MAX_SHIFT_MIN = 360;
/** Candidate spacing — 30 min keeps hourly-data noise from over-fitting. */
export const DEPARTURE_SCAN_STEP_MIN = 30;
/** Hard cap on the Timelines `nowPlus{n}h` window so absurd trips stay fetchable. */
export const DEPARTURE_SCAN_MAX_END_HOURS = 48;
