import { useDeferredValue, useMemo } from "react";
import { buildMapAlongRouteAlerts } from "./buildMapAlongRouteAlerts";
import { buildNwsAlertGeoJsonForMap } from "../weatherAlerts/buildNwsAlertGeoJsonForMap";
import { buildDriveRouteAheadFromImpacts, type DriveAheadLine } from "./driveRouteAhead";
import {
  closestPointOnPolyline,
  geometryForPlanningMapDisplay,
  geometryForRouteOverviewDisplay,
  pointAtAlongMeters,
  polylineLengthMeters,
  routeLineGeometryForDriveDisplay,
} from "./routeGeometry";
import { routeLineGeometryKind } from "./viewModeContract";
import { placeReferencePhrase, type RoutePlaceAnchor } from "./routePlaceReference";
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
  /** Route whose line is highlighted/inspected — markers snap to its painted geometry. */
  lineFocusId?: string;
  viewMode: MapViewMode;
  personalForkPreviewGeometry: LngLat[] | null;
  guidanceIsPersonalFork: boolean;
  lockedNavigationRouteId: string | undefined;
  guidanceRoute: NavRoute | undefined;
  routePlaceAnchors?: RoutePlaceAnchor[];
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
    lineFocusId,
    viewMode,
    personalForkPreviewGeometry,
    guidanceIsPersonalFork,
    lockedNavigationRouteId,
    guidanceRoute,
    routePlaceAnchors = [],
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
   * DOT hazard triangles — snap each impact onto the EXACT polyline the map
   * paints (post-rewrite), not whichever geometry the match happened to run
   * on. Bill, Nov 20 (build 621/622): markers derived from a different
   * geometry frame kept landing on phantom corridors / in the Gulf.
   * closestPointOnPolyline always returns a point ON this array, so a marker
   * physically cannot float off the visible line — worst case it sits at the
   * nearest painted point to its true corridor position.
   */
  const dotEventMarkersForMap = useMemo(() => {
    const route =
      driveMapRoutesForMap.find((r) => r.id === lineFocusId) ??
      driveMapRoutesForMap.find((r) => r.id === guidanceRouteId);
    if (!route?.geometry?.length || !routeImpactsForUi.length) return [];
    /* Snap to the DISPLAY geometry the line layer actually paints —
     * routeCoordinatesForMap decimates long routes to chords (planning) or
     * slices an ahead window (drive), so markers on raw geometry float
     * beside the painted line at low zoom and "fall into place" zoomed in
     * (Bill, build 622, Nov 20). Events beyond the painted window project
     * far off the end — the 400m lateral check hides them instead of
     * piling them at the slice tail. */
    /* Along quantized to 2 km — the memo used to re-project every impact
     * onto a 10–24k-vertex slice each GPS tick (~2.4M segment checks/sec,
     * enough to stall a phone; build 623 crash). The window slides in
     * steps; markers still land on the painted line. */
    const alongQ = Math.round(Math.max(0, userAlongGuidanceM) / 2000) * 2000;
    const kind = routeLineGeometryKind(viewMode, navigationStarted, {
      isOverviewPip: false,
      userAlongMeters: alongQ,
    });
    const painted =
      kind === "driveAhead"
        ? routeLineGeometryForDriveDisplay(route.geometry, alongQ)
        : viewMode === "route" || viewMode === "topdown"
          ? geometryForRouteOverviewDisplay(route.geometry)
          : geometryForPlanningMapDisplay(route.geometry);
    if (!painted || painted.length < 2) return [];
    return routeImpactsForUi
      .filter((i) => i.source === "dot511")
      .flatMap((i) => {
        const c = closestPointOnPolyline(i.lngLat, painted);
        if (c.lateralMetersApprox > 400) return [];
        return [
          {
            id: i.id,
            lngLat: c.lngLat,
            label: i.driverHeadline,
            kind:
              i.category === "closure" ||
              i.category === "incident" ||
              i.category === "construction"
                ? i.category
                : ("other" as const),
          },
        ];
      });
  }, [
    driveMapRoutesForMap,
    routeImpactsForUi,
    lineFocusId,
    guidanceRouteId,
    viewMode,
    navigationStarted,
    Math.round(Math.max(0, userAlongGuidanceM) / 2000),
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
   * NWS warning polygons on the map (Rt / Mp; hidden in Dr). Watches stay in the list.
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
  /* Drive gets road-only serious/avoid bands (see routeAheadMapBands); Rt/Mp get the full set. */
  const mapStormAlongRouteBandsForDrive = activeTripMapOverlays
    ? deferredRouteAheadMapBands
    : [];
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
      placePhraseAt: (alongM) => {
        if (!routePlaceAnchors.length) return null;
        return placeReferencePhrase(pointAtAlongMeters(g, alongM), routePlaceAnchors, "nearby");
      },
    });
  }, [
    driveModeUi,
    guidanceRoute?.geometry,
    guidanceRoute?.baseEtaMinutes,
    userAlongGuidanceM,
    routeImpactsForUi,
    routePlaceAnchors,
  ]);

  return {
    driveMapRoutesForMap,
    dotEventMarkersForMap,
    deferredNwsAlertGeoJsonForMap,
    navMapLiteMode,
    deferredRouteImpactsForUi,
    mapAlongRouteAlertsForDrive,
    mapStormAlongRouteBandsForDrive,
    driveRouteAheadLine,
  };
}
