/**
 * Weather / storm advisory layer (US NWS first; add providers per {@link WeatherAlertRegionCode}).
 */
export type {
  NormalizedWeatherAlert,
  RouteOverlapResult,
  WeatherAlertFetchResult,
  WeatherAlertProviderId,
  WeatherAlertRegionCode,
} from "./types";
export {
  computeRouteOverlapWithAlerts,
  rankNwsSeverity,
  sortWeatherAlertsBySeverity,
} from "./geometryOverlap";
export type { BuildNwsResultOptions, NwsBrowseBounds, NwsRouteCorridorsMergedOutcome } from "./nwsUsProvider";
export {
  fetchNwsAlertsForBrowseViewport,
  fetchNwsAlertsForNorthAmericaBrowse,
  fetchNwsAlertsForRouteCorridor,
  fetchNwsAlertsForRouteCorridorsMerged,
  mergeWeatherAlertFetchResults,
  nwsBrowseBoundsAroundLngLat,
} from "./nwsUsProvider";
