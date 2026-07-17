import { useDeferredValue, useMemo } from "react";
import { buildMapAlongRouteAlerts } from "./buildMapAlongRouteAlerts";
import { buildNwsAlertGeoJsonForMap } from "../weatherAlerts/buildNwsAlertGeoJsonForMap";
import { buildDriveRouteAheadFromImpacts, type DriveAheadLine } from "./driveRouteAhead";
import { polylineLengthMeters } from "./routeGeometry";
import { isNavMapLiteMode } from "../utils/dataSaver";
import { PERSONAL_FORK_ROUTE_ID } from "../personalForks";
import type { TimelineItem, RouteAheadStormBand } from "./routeAheadSync";
import type { RouteAlert } from "./routeAlerts";
import type { RouteImpact } from "./routeImpacts";
import type { LngLat, NavRoute, TripPlan } from "./types";
import type { StormProgressStripBand } from "../weatherAlerts/geometryOverlap";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import type { MapViewMode } from "../ui/driveMapTypes";

export type UseDriveMapOverlaysDeps = {
  navigationGuidanceGeometry: LngLat[] | undefined;
  driveMapRoutes: NavRoute[];
  navigationStarted: boolean;
  guidanceRouteId: string;
  viewMode: MapViewMode;
  personalForkPreviewGeometry: LngLat[] | null;
  guidanceIsPersonalFork: boolean;
  lockedNavigationRouteId: string | undefined;
  guidanceRoute: NavRoute | undefined;
  progressStripAlerts: RouteAlert[];
  routeAheadTimeline: TimelineItem[];
  advisoryRouteImpacts: RouteImpact[];
  isPlus: boolean;
  advisoryLifeSafetyOn: boolean;
  settingStormEnabled: boolean;
  nwsMapOverlapRouteGeom: LngLat[] | undefined;
  stormCorridorAlerts: NormalizedWeatherAlert[];
  stormMapGeoJson: GeoJSON.FeatureCollection | null | undefined;
  stormMapGeoJsonForMap: GeoJSON.FeatureCollection | undefined;
  nwsAlertsAffectingActiveRoute: NormalizedWeatherAlert[];
  advisoryStormStripBands: RouteAheadStormBand[];
  guidanceRouteLengthM: number;
  heavyAdvisoryAlongM: number;
  driveEtaMinutes: number | null | undefined;
  routeAheadMapBands: StormProgressStripBand[];
  dataSaverMode: boolean;
  plan: TripPlan;
  driveModeUi: boolean;
  routeImpactsForUi: RouteImpact[];
  userAlongGuidanceM: number;
};

/**
 * DriveMap overlay derivations (Phase: App.tsx peel). Groups the memoized route/overlay
 * geometry the map + approach banner need so App.tsx doesn't own the raw `useMemo` chain.
 */
export function useDriveMapOverlays(deps: UseDriveMapOverlaysDeps) {
  const {
    navigationGuidanceGeometry,
    driveMapRoutes,
    navigationStarted,
    guidanceRouteId,
    viewMode,
    personalForkPreviewGeometry,
    guidanceIsPersonalFork,
    lockedNavigationRouteId,
    guidanceRoute,
    progressStripAlerts,
    routeAheadTimeline,
    advisoryRouteImpacts,
    isPlus,
    advisoryLifeSafetyOn,
    settingStormEnabled,
    nwsMapOverlapRouteGeom,
    stormCorridorAlerts,
    stormMapGeoJson,
    stormMapGeoJsonForMap,
    nwsAlertsAffectingActiveRoute,
    advisoryStormStripBands,
    guidanceRouteLengthM,
    heavyAdvisoryAlongM,
    driveEtaMinutes,
    routeAheadMapBands,
    dataSaverMode,
    plan,
    driveModeUi,
    routeImpactsForUi,
    userAlongGuidanceM,
  } = deps;

  /** Map fit + draw: full guidance geometry; layers apply display-tier subsampling. */
  const driveMapRoutesForMap = useMemo(() => {
    const full = navigationGuidanceGeometry;
    let routes = driveMapRoutes;
    /* Only rewrite the active guidance leg — keep locked corridor geom when showing a rejoin stub. */
    if (navigationStarted && full?.length) {
      routes = routes.map((r) =>
        r.id === guidanceRouteId ? { ...r, geometry: full } : r
      );
    }
    /* Approaching a habitual fork: draw the branch beside the main corridor. */
    if (
      navigationStarted &&
      viewMode === "drive" &&
      personalForkPreviewGeometry &&
      personalForkPreviewGeometry.length >= 2 &&
      !guidanceIsPersonalFork
    ) {
      const preview: (typeof routes)[number] = {
        id: PERSONAL_FORK_ROUTE_ID,
        role: "balanced",
        label: "Your route",
        geometry: personalForkPreviewGeometry,
        baseEtaMinutes: 1,
      };
      if (!routes.some((r) => r.id === PERSONAL_FORK_ROUTE_ID)) {
        routes = [...routes, preview];
      }
    }
    return routes;
  }, [
    driveMapRoutes,
    navigationStarted,
    navigationGuidanceGeometry,
    lockedNavigationRouteId,
    guidanceRouteId,
    viewMode,
    personalForkPreviewGeometry,
    guidanceIsPersonalFork,
  ]);

  /**
   * Map line highlights — paint each corridor alert at its real along-route position.
   * (Strip layout re-anchors for visibility; map stays at true along-route meters.)
   */
  const mapAlongRouteAlerts = useMemo(
    () =>
      buildMapAlongRouteAlerts({
        guidanceGeometry: guidanceRoute?.geometry,
        progressStripAlerts,
        routeAheadTimeline,
        advisoryRouteImpacts,
      }),
    [progressStripAlerts, guidanceRoute?.geometry, routeAheadTimeline, advisoryRouteImpacts]
  );

  /**
   * NWS warning polygons on the map (Rt / Mp; hidden in Dr). Independent of radar overlay.
   * Plus: follows About → NWS (`settingStormEnabled`).
   */
  const nwsAlertGeoJsonForMap = useMemo(
    () =>
      buildNwsAlertGeoJsonForMap({
        isPlus,
        advisoryLifeSafetyOn,
        settingStormEnabled,
        nwsMapOverlapRouteGeom,
        stormCorridorAlerts,
        stormMapGeoJson,
        stormMapGeoJsonForMap,
        nwsAlertsAffectingActiveRoute,
        advisoryStormStripBands,
        guidanceRouteLengthM,
        heavyAdvisoryAlongM,
        planEtaMinutes: guidanceRoute?.baseEtaMinutes ?? null,
        driveEtaMinutes: driveEtaMinutes ?? null,
      }),
    [
      advisoryLifeSafetyOn,
      settingStormEnabled,
      isPlus,
      nwsMapOverlapRouteGeom,
      stormMapGeoJsonForMap,
      nwsAlertsAffectingActiveRoute,
      stormCorridorAlerts,
      stormMapGeoJson,
      guidanceRouteLengthM,
      heavyAdvisoryAlongM,
      guidanceRoute?.baseEtaMinutes,
      driveEtaMinutes,
      advisoryStormStripBands,
    ]
  );

  /** Defer map overlay props so pan/zoom is not competing with advisory recomputes. */
  const deferredMapAlongRouteAlerts = useDeferredValue(mapAlongRouteAlerts);
  const deferredRouteAheadMapBands = useDeferredValue(routeAheadMapBands);
  const deferredNwsAlertGeoJsonForMap = useDeferredValue(nwsAlertGeoJsonForMap);

  /** Long-trip / data-saver nav: static radar frame, less background churn. */
  const navMapLiteMode = isNavMapLiteMode(
    navigationStarted,
    dataSaverMode,
    guidanceRouteLengthM
  );

  const deferredRouteImpactsForUi = useDeferredValue(routeImpactsForUi);
  /** No active trip — drop deferred corridor overlays immediately (avoid ghost route-line halos). */
  const activeTripMapOverlays =
    navigationStarted ||
    plan.routes.some((r) => r.geometry && r.geometry.length >= 2);
  const mapAlongRouteAlertsForDrive =
    activeTripMapOverlays && viewMode !== "drive" ? deferredMapAlongRouteAlerts : [];
  const mapStormAlongRouteBandsForDrive =
    activeTripMapOverlays && viewMode !== "drive" ? deferredRouteAheadMapBands : [];
  const driveRouteAheadLine = useMemo<DriveAheadLine | null>(() => {
    if (!driveModeUi) return null;
    const g = guidanceRoute?.geometry;
    if (!g?.length) return null;
    const totalMeters = polylineLengthMeters(g);
    if (totalMeters <= 1) return null;
    return buildDriveRouteAheadFromImpacts({
      impacts: routeImpactsForUi,
      totalMeters,
      userAlongM: userAlongGuidanceM,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes,
    });
  }, [
    driveModeUi,
    guidanceRoute?.geometry,
    guidanceRoute?.baseEtaMinutes,
    userAlongGuidanceM,
    routeImpactsForUi,
  ]);

  return {
    driveMapRoutesForMap,
    deferredNwsAlertGeoJsonForMap,
    navMapLiteMode,
    deferredRouteImpactsForUi,
    mapAlongRouteAlertsForDrive,
    mapStormAlongRouteBandsForDrive,
    driveRouteAheadLine,
  };
}
