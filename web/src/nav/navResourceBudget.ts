import type { MapViewMode } from "../ui/driveMapTypes";
import { isLongTripRoute, isUltraLongTripRoute } from "../utils/dataSaver";

export type NavResourceBudgetInput = {
  navigationStarted: boolean;
  viewMode: MapViewMode;
  appForeground: boolean;
  showRadar: boolean;
  hasPlannedRoute: boolean;
  hasGuidanceGeometry: boolean;
  routeLengthM: number;
  dataSaverMode: boolean;
  settingStormEnabled: boolean;
  settingWeatherHintsEnabled: boolean;
  progressCalloutsOpen: boolean;
  stormBarExpanded: boolean;
  isPlus: boolean;
  routeWeatherReady: boolean;
  hasEffectiveUserLngLat: boolean;
};

export type NavResourceBudget = {
  /** Navigating in drive view — navigation-first, lean advisory network tier. */
  driveNavMode: boolean;
  /** Route or map surface — full radar + corridor refresh allowed. */
  planningSurfaceActive: boolean;
  /** RainViewer mosaic tiles on the basemap (Route/Map only). */
  radarMapOverlayOn: boolean;
  /** Sample reflectivity along the active leg polyline. */
  radarRouteSamplingEnabled: boolean;
  /** Corridor hourly along the route (Tomorrow.io / WeatherKit). */
  tioRouteFetchEnabled: boolean;
  /** Point minute precip + hourly at the puck. */
  tioPointFetchEnabled: boolean;
  /** Watchdogs may auto-bump corridor forecast (not manual refresh). */
  advisoryForecastRepairEnabled: boolean;
  /** Route-ahead audit should expect live corridor weather sync. */
  advisoryWeatherSyncEnabled: boolean;
};

export function isDriveNavMode(navigationStarted: boolean, viewMode: MapViewMode): boolean {
  return navigationStarted && viewMode === "drive";
}

export function isPlanningSurfaceActive(viewMode: MapViewMode): boolean {
  return viewMode === "route" || viewMode === "topdown";
}

export function computeRadarMapOverlayOn(
  showRadar: boolean,
  driveNavMode: boolean,
  appForeground: boolean
): boolean {
  return showRadar && !driveNavMode && appForeground;
}

/**
 * Tiered fetch gates while navigating — Drive keeps NWS + traffic + replan;
 * Route/Map keep radar overlay, route sampling, and corridor forecast refresh.
 */
export function buildNavResourceBudget(input: NavResourceBudgetInput): NavResourceBudget {
  const driveNavMode = isDriveNavMode(input.navigationStarted, input.viewMode);
  const planningSurfaceActive = isPlanningSurfaceActive(input.viewMode);
  const radarMapOverlayOn = computeRadarMapOverlayOn(
    input.showRadar,
    driveNavMode,
    input.appForeground
  );

  const ultraLongPlannedRoute = isUltraLongTripRoute(input.routeLengthM);
  const longTrip = isLongTripRoute(input.routeLengthM);

  const radarSampleRequested =
    radarMapOverlayOn ||
    (planningSurfaceActive &&
      !driveNavMode &&
      (input.settingStormEnabled ||
        input.settingWeatherHintsEnabled ||
        input.progressCalloutsOpen));

  const radarRouteSamplingEnabled = Boolean(
    input.hasGuidanceGeometry &&
      (input.navigationStarted || input.hasPlannedRoute) &&
      !driveNavMode &&
      radarSampleRequested &&
      (input.navigationStarted ||
        (!ultraLongPlannedRoute &&
          (!longTrip || input.settingStormEnabled)) ||
        radarMapOverlayOn ||
        input.progressCalloutsOpen)
  );

  const tioBaseEnabled =
    input.isPlus &&
    input.routeWeatherReady &&
    input.hasEffectiveUserLngLat &&
    input.appForeground;

  const tioPointFetchEnabled =
    tioBaseEnabled &&
    (driveNavMode
      ? input.stormBarExpanded
      : input.dataSaverMode
        ? input.stormBarExpanded
        : true);

  const tioRouteCorridorEnabled =
    input.isPlus &&
    input.routeWeatherReady &&
    input.appForeground &&
    input.hasGuidanceGeometry;

  const navLiteForCorridorFetch =
    input.navigationStarted && (input.dataSaverMode || longTrip);

  const tioRouteFetchEnabled =
    !driveNavMode &&
    tioRouteCorridorEnabled &&
    !(
      navLiteForCorridorFetch &&
      !input.stormBarExpanded &&
      !input.navigationStarted &&
      !input.progressCalloutsOpen
    ) &&
    (input.dataSaverMode
      ? input.stormBarExpanded || input.navigationStarted || input.progressCalloutsOpen
      : input.stormBarExpanded ||
        input.navigationStarted ||
        input.progressCalloutsOpen ||
        (input.hasPlannedRoute && !longTrip));

  return {
    driveNavMode,
    planningSurfaceActive,
    radarMapOverlayOn,
    radarRouteSamplingEnabled,
    tioRouteFetchEnabled,
    tioPointFetchEnabled,
    advisoryForecastRepairEnabled: !driveNavMode,
    advisoryWeatherSyncEnabled: !driveNavMode,
  };
}
