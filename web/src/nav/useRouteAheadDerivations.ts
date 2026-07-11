import { useMemo, type MutableRefObject } from "react";
import { routeForecastHasSignificantWeather, type RouteForecast } from "../services/tomorrowIo";
import { buildWindImpacts } from "./tomorrowIoImpacts";
import {
  buildRouteImpacts,
  compareRouteImpactPriority,
  radarMosaicToProgressStripBands,
  routeImpactToRouteAlert,
  type RouteImpact,
} from "./routeImpacts";
import {
  applyArrivalVerdictsToImpacts,
  nextHazardAffectingYouLine,
  sortImpactsByArrivalPriority,
} from "./hazardArrivalVerdict";
import { augmentAlertsForProgressStrip, type RouteAlert } from "./routeAlerts";
import {
  buildRouteAheadTimeline,
  filterAlertsForDriveMap,
  timelineToProgressStripBands,
  type RouteAheadStormBand,
  type TimelineItem,
} from "./routeAheadSync";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import type { StormRouteOutlookBand } from "./routeForecastTimeline";
import { computeTrafficBypassOffer, type TrafficBypassOffer } from "./trafficBypassOffer";
import {
  TRAFFIC_BYPASS_ENABLED,
  RADAR_SOFT_THRESHOLD,
  WEATHER_DETAIL_AHEAD_M,
  WEATHER_DETAIL_BEHIND_M,
  WEATHER_PLANNING_DETAIL_AHEAD_M,
} from "./constants";
import { radarDisplayIntensity } from "./radarReflectivityScale";
import { postedSpeedMphAt } from "./postedSpeed";
import type { MapViewMode } from "../ui/driveMapTypes";
import {
  filterAlertsAffectingRoute,
  pointInAnyPolygonGeometry,
  buildRouteStormStripBands,
  mergeProgressStripWeatherBands,
  sortWeatherAlertsBySeverity,
  type RouteStormStripBand,
  type StormProgressStripBand,
} from "../weatherAlerts/geometryOverlap";
import { mapGeoJsonFromAlerts } from "../weatherAlerts/mapGeoJsonFromAlerts";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { nwsAlertIsBasicEmergency } from "../weatherAlerts/basicEmergencyFilter";
import { nwsAlertsForLocalForecast } from "../weatherAlerts/localForecastNws";
import {
  mergeStormCorridorAdvisoryLine,
  resolveStormCorridorIntersect,
} from "./stormCorridorIntersectBridge";
import type { StormCorridorIntersectResult } from "../features/stormCorridorIntersect";
import { quantizeLngLatForHeavyUi } from "../utils/dataSaver";
import type { TrafficBypassCompareState } from "../state/routeCompareStore";
import type { LngLat, NavRoute } from "./types";
import type { RouteSituationSlice } from "../situation/types";
import type { TrafficOverlay } from "../situation/fusedSnapshot";
import type { ScoredRoute } from "../scoring/scoreRoutes";

export type UseRouteAheadDerivationsDeps = {
  nwsMapOverlapRouteGeom: LngLat[] | undefined;
  stormCorridorAlerts: NormalizedWeatherAlert[];
  effectiveUserLngLat: LngLat | null;
  navigationStarted: boolean;
  advisoryPlusDetailOn: boolean;
  guidanceRoute: NavRoute | undefined;
  nwsNavCorridorGeom: LngLat[] | undefined;
  guidanceRouteLengthM: number;
  userAlongGuidanceM: number;
  advisoryUserAlongM: number;
  tioRouteForecast: RouteForecast | null;
  isPlus: boolean;
  advisoryLifeSafetyOn: boolean;
  radarMosaicMaxIntensity: number;
  guidanceSlice: RouteSituationSlice | undefined;
  effectiveUserLngLatRef: MutableRefObject<LngLat | null>;
  heavyAdvisoryAlongM: number;
  scored: ScoredRoute[];
  lineFocusId: string;
  trafficOverlay: TrafficOverlay | undefined;
  corridorWeatherDetail: string;
  radarMosaicSamples: { t: number; intensity: number }[];
  showTrafficCorridorOnRoute: boolean;
  showRoadNoticesOnRoute: boolean;
  driveEtaMinutes: number | null;
  viewMode: MapViewMode;
  trafficDelayMinutesForBypass: number;
  mapboxToken: string | undefined;
  destLngLat: LngLat | null;
  roadAdvisoryDetailOn: boolean;
  settingTrafficEnabled: boolean;
  trafficBypassCompare: TrafficBypassCompareState | null;
  guidanceRouteId: string;
  planRoutes: NavRoute[];
  lockedNavigationRouteId: string;
  temporaryGuidanceRouteId?: string | null;
  /** Auto off-route hold — show B/C rejoin preview on the map before guidance commits. */
  offRouteHoldPreviewActive?: boolean;
  stormMapGeoJson: GeoJSON.FeatureCollection | null;
};

export type UseRouteAheadDerivationsResult = {
  alertsOnActiveRouteGeom: NormalizedWeatherAlert[];
  nwsAlertsAffectingActiveRoute: NormalizedWeatherAlert[];
  puckLngLatForNwsScan: LngLat | null;
  stormNwsPuckInside: NormalizedWeatherAlert[];
  nwsAlertsForGuidanceAdvisory: NormalizedWeatherAlert[];
  routeStormStripAlerts: NormalizedWeatherAlert[];
  weatherDetailAlongM: number;
  routeStormStripBands: RouteStormStripBand[];
  tioRouteHasWeather: boolean;
  showWeatherImpactsOnRoute: boolean;
  localForecastNwsAlertsRaw: NormalizedWeatherAlert[];
  localForecastNwsAlerts: NormalizedWeatherAlert[];
  stormMapGeoJsonForMap: GeoJSON.FeatureCollection | undefined;
  routeImpacts: RouteImpact[];
  routeImpactsForUi: RouteImpact[];
  advisoryRouteImpacts: RouteImpact[];
  advisoryStormStripBands: RouteAheadStormBand[];
  routeAheadTimeline: TimelineItem[];
  routeAheadProgressBands: StormProgressStripBand[];
  stormOutlookBands: StormRouteOutlookBand[];
  routeAheadMapBands: StormProgressStripBand[];
  routeAlerts: RouteAlert[];
  trafficBypassContext: TrafficBypassOffer | null;
  showTrafficBypassCta: boolean;
  /** Nearest hazard likely to matter at your ETA — advisory preview line. */
  nextHazardAtEtaLine: string | null;
  /** Experimental radar-intersect along route (null when feature off). */
  stormCorridorIntersect: StormCorridorIntersectResult | null;
  driveMapRoutes: NavRoute[];
  progressRailRoute: NavRoute | undefined;
  postedMph: number | null;
  progressStripAlerts: RouteAlert[];
};

export function useRouteAheadDerivations(
  deps: UseRouteAheadDerivationsDeps
): UseRouteAheadDerivationsResult {
  const {
    nwsMapOverlapRouteGeom,
    stormCorridorAlerts,
    effectiveUserLngLat,
    navigationStarted,
    advisoryPlusDetailOn,
    guidanceRoute,
    nwsNavCorridorGeom,
    guidanceRouteLengthM,
    userAlongGuidanceM,
    advisoryUserAlongM,
    tioRouteForecast,
    isPlus,
    advisoryLifeSafetyOn,
    radarMosaicMaxIntensity,
    guidanceSlice,
    effectiveUserLngLatRef,
    heavyAdvisoryAlongM,
    scored,
    lineFocusId,
    trafficOverlay,
    corridorWeatherDetail,
    radarMosaicSamples,
    showTrafficCorridorOnRoute,
    showRoadNoticesOnRoute,
    driveEtaMinutes,
    viewMode,
    trafficDelayMinutesForBypass,
    mapboxToken,
    destLngLat,
    roadAdvisoryDetailOn,
    settingTrafficEnabled,
    trafficBypassCompare,
    planRoutes,
    lockedNavigationRouteId,
    offRouteHoldPreviewActive = false,
    stormMapGeoJson,
  } = deps;

  /** NWS polygons + route bands: corridor alerts that touch or sit ahead of the active leg (~28 mi buffer). */
  const alertsOnActiveRouteGeom = useMemo(() => {
    const g = nwsMapOverlapRouteGeom;
    if (!g?.length) return [] as typeof stormCorridorAlerts;
    return filterAlertsAffectingRoute(g, stormCorridorAlerts);
  }, [stormCorridorAlerts, nwsMapOverlapRouteGeom]);

  const nwsAlertsAffectingActiveRoute = alertsOnActiveRouteGeom;

  /** Polygons containing GPS — surfaced even when the route line misses the geometry. */
  const puckLngLatForNwsScan = useMemo(
    () => quantizeLngLatForHeavyUi(effectiveUserLngLat, navigationStarted),
    [effectiveUserLngLat?.[0], effectiveUserLngLat?.[1], navigationStarted]
  );
  const stormNwsPuckInside = useMemo(() => {
    const p = puckLngLatForNwsScan;
    if (!p?.length || !stormCorridorAlerts.length) return [];
    const [lng, lat] = p;
    return stormCorridorAlerts.filter(
      (a) => a.geometry && pointInAnyPolygonGeometry(lng, lat, a.geometry)
    );
  }, [puckLngLatForNwsScan, stormCorridorAlerts]);

  /** Route corridor + at-your-position alerts for advisory timeline and chips. */
  const nwsAlertsForGuidanceAdvisory = useMemo(() => {
    const byId = new Map<string, NormalizedWeatherAlert>();
    for (const a of nwsAlertsAffectingActiveRoute) byId.set(a.id, a);
    for (const a of stormNwsPuckInside) byId.set(a.id, a);
    return sortWeatherAlertsBySeverity([...byId.values()]);
  }, [nwsAlertsAffectingActiveRoute, stormNwsPuckInside]);

  /** Alerts used for route storm bands — basic tier only sees life-safety polygons. */
  const routeStormStripAlerts = useMemo(() => {
    const g = guidanceRoute?.geometry ?? nwsNavCorridorGeom;
    const affecting =
      g?.length && g === nwsMapOverlapRouteGeom
        ? alertsOnActiveRouteGeom
        : g?.length
          ? filterAlertsAffectingRoute(g, stormCorridorAlerts)
          : [];
    const byId = new Map<string, (typeof stormCorridorAlerts)[number]>();
    for (const a of affecting) byId.set(a.id, a);
    for (const a of stormNwsPuckInside) byId.set(a.id, a);
    const sorted = sortWeatherAlertsBySeverity([...byId.values()]);
    if (advisoryPlusDetailOn) return sorted;
    return sorted.filter(nwsAlertIsBasicEmergency);
  }, [
    advisoryPlusDetailOn,
    guidanceRoute?.geometry,
    nwsNavCorridorGeom,
    nwsMapOverlapRouteGeom,
    alertsOnActiveRouteGeom,
    stormCorridorAlerts,
    stormNwsPuckInside,
  ]);

  /** Quantize drive position so distant→precise band upgrades don't run every GPS tick. */
  const weatherDetailAlongM = useMemo(() => {
    if (!navigationStarted) return advisoryUserAlongM;
    const m = userAlongGuidanceM;
    if (!Number.isFinite(m) || m < 0) return 0;
    const stepM = 8_000;
    return Math.floor(m / stepM) * stepM;
  }, [navigationStarted, userAlongGuidanceM, advisoryUserAlongM]);

  /**
   * NWS spans along the active route — precise geometry near you, coarse preview farther out.
   * Feeds the progress strip, map route highlights, and unified route impacts.
   */
  const routeStormStripBands = useMemo(() => {
    const routeGeom = guidanceRoute?.geometry ?? nwsNavCorridorGeom;
    if (!routeGeom?.length || guidanceRouteLengthM <= 0) return [];
    return buildRouteStormStripBands(routeGeom, guidanceRouteLengthM, routeStormStripAlerts, {
      userAlongM: weatherDetailAlongM,
      navigationActive: navigationStarted,
      detailAheadM: WEATHER_DETAIL_AHEAD_M,
      detailBehindM: WEATHER_DETAIL_BEHIND_M,
      planningDetailAheadM: WEATHER_PLANNING_DETAIL_AHEAD_M,
    });
  }, [
    guidanceRoute?.geometry,
    nwsNavCorridorGeom,
    guidanceRouteLengthM,
    routeStormStripAlerts,
    navigationStarted,
    weatherDetailAlongM,
  ]);

  /** Weather impacts (NWS / radar / corridor forecast) on the strip + map — Plus only. */
  const tioRouteHasWeather = routeForecastHasSignificantWeather(tioRouteForecast);
  const showWeatherImpactsOnRoute =
    isPlus &&
    advisoryLifeSafetyOn &&
    (advisoryPlusDetailOn ||
      tioRouteHasWeather ||
      routeStormStripBands.length > 0 ||
      stormCorridorAlerts.length > 0 ||
      radarDisplayIntensity(radarMosaicMaxIntensity) >= RADAR_SOFT_THRESHOLD ||
      radarDisplayIntensity(guidanceSlice?.radarIntensity ?? 0) >= RADAR_SOFT_THRESHOLD);

  /** NWS at the user’s position only (local forecast — not the whole browse/route corridor). */
  const localForecastNwsAlertsRaw = useMemo(
    () =>
      nwsAlertsForLocalForecast({
        userLngLat: effectiveUserLngLat,
        corridorAlerts: stormCorridorAlerts,
      }),
    [effectiveUserLngLat, stormCorridorAlerts]
  );

  const localForecastNwsAlerts = useMemo(
    () =>
      advisoryPlusDetailOn
        ? localForecastNwsAlertsRaw
        : localForecastNwsAlertsRaw.filter(nwsAlertIsBasicEmergency),
    [advisoryPlusDetailOn, localForecastNwsAlertsRaw]
  );

  const stormMapGeoJsonForMap = useMemo((): GeoJSON.FeatureCollection | undefined => {
    const g = nwsMapOverlapRouteGeom;
    if (!g?.length) return undefined;
    const etaBands: RouteAheadStormBand[] = routeStormStripBands.map((b) => ({
      id: b.id,
      event: b.event,
      severity: b.impactSeverity,
      startMeters: b.startMeters,
      endMeters: b.endMeters,
      expiresIso: b.expiresIso,
      onsetIso: b.onsetIso,
      alertId: b.alertId,
      crossesRoute: b.crossesRoute,
    }));
    const etaFiltered = filterAlertsForDriveMap(stormCorridorAlerts, etaBands, {
      routeTotalMeters: guidanceRouteLengthM,
      userAlongMeters: heavyAdvisoryAlongM,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes ?? null,
      driveEtaMinutes: driveEtaMinutes ?? null,
    });
    const corridorIds = new Set(etaFiltered.map((a) => a.id));
    const byId = new Map<string, GeoJSON.Feature>();
    if (stormMapGeoJson?.features?.length) {
      for (const f of stormMapGeoJson.features) {
        const id = String((f.properties as { id?: string } | undefined)?.id ?? "");
        if (id && corridorIds.has(id)) byId.set(id, f);
      }
    }
    for (const f of mapGeoJsonFromAlerts(
      etaFiltered.filter((a) => a.geometry && !byId.has(a.id))
    ).features) {
      const id = String((f.properties as { id?: string } | undefined)?.id ?? "");
      if (id) byId.set(id, f);
    }
    const features = [...byId.values()];
    if (!features.length) return undefined;
    return { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
  }, [
    stormMapGeoJson,
    nwsMapOverlapRouteGeom,
    stormCorridorAlerts,
    routeStormStripBands,
    guidanceRouteLengthM,
    heavyAdvisoryAlongM,
    guidanceRoute?.baseEtaMinutes,
    driveEtaMinutes,
  ]);

  /**
   * Unified Road Ahead model — every surface (drive status, advisory bar, progress rail, map highlights, bypass)
   * reads from the same `RouteImpact[]`, so weather, traffic, closures, and incidents can never disagree.
   */
  const routeImpacts = useMemo<RouteImpact[]>(() => {
    const geometry = guidanceRoute?.geometry;
    if (!geometry?.length) return [];
    const totalM = guidanceRouteLengthM;
    const navActive = navigationStarted;
    const list = buildRouteImpacts({
      geometry,
      userLngLat: effectiveUserLngLatRef.current,
      userAlongM: navActive && totalM > 0 ? heavyAdvisoryAlongM : 0,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes,
      totalMeters: guidanceRouteLengthM,
      slice: navActive ? guidanceSlice : undefined,
      trafficForRoute: navActive ? scored.find((s) => s.route.id === lineFocusId) : undefined,
      trafficLeg: navActive ? ((lineFocusId ? trafficOverlay?.[lineFocusId] : null) ?? null) : null,
      corridorWeatherDetail,
      nwsBands: routeStormStripBands.map((b) => ({
        startM: b.startMeters,
        endM: b.endMeters,
        severity: b.nwsSeverity,
      })),
      nwsAlerts: nwsAlertsAffectingActiveRoute,
      radarMosaicSamples,
      mapboxIncidents: guidanceRoute?.mapboxIncidents,
    });

    if (tioRouteForecast && guidanceRouteLengthM > 0) {
      const planEta = guidanceRoute?.baseEtaMinutes;
      if (planEta && planEta > 0) {
        // Wind track — gusts along the corridor (forecast summary cards removed; too vague vs ETA).
        list.push(...buildWindImpacts(tioRouteForecast, geometry, planEta, guidanceRouteLengthM));
      }
    }

    list.sort(compareRouteImpactPriority);
    return applyArrivalVerdictsToImpacts({
      impacts: list,
      userAlongM: navActive && totalM > 0 ? heavyAdvisoryAlongM : 0,
      totalMeters: totalM,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes,
      driveEtaMinutes: driveEtaMinutes ?? null,
    });
  }, [
    navigationStarted,
    guidanceRoute?.geometry,
    guidanceRoute?.baseEtaMinutes,
    heavyAdvisoryAlongM,
    guidanceSlice,
    scored,
    lineFocusId,
    trafficOverlay,
    corridorWeatherDetail,
    routeStormStripBands,
    nwsAlertsAffectingActiveRoute,
    radarMosaicSamples,
    tioRouteForecast,
    guidanceRouteLengthM,
    effectiveUserLngLatRef,
    driveEtaMinutes,
  ]);

  /** Filter impacts by the same UI toggles that gated the legacy alert list. */
  const routeImpactsForUi = useMemo(() => {
    if (!isPlus) return [];
    return routeImpacts.filter((i) => {
      if (i.source === "tomorrowIo") return true;
      if (i.category === "traffic") return showTrafficCorridorOnRoute;
      if (i.category === "closure" || i.category === "incident" || i.category === "construction") {
        return showRoadNoticesOnRoute;
      }
      // Weather impacts (NWS / radar) — gated by storm session detail or live corridor wx.
      return showWeatherImpactsOnRoute;
    });
  }, [isPlus, routeImpacts, showTrafficCorridorOnRoute, showRoadNoticesOnRoute, showWeatherImpactsOnRoute]);

  /** Advisory panel: impacts ordered like the progress rail (nearest first). Carries the full
   *  RouteImpact fields the bar needs to split rows by source/category and to slot severe NWS
   *  bands into the storm strip (source-attribution + start/end-meters). */
  const advisoryRouteImpacts = useMemo(() => {
    return sortImpactsByArrivalPriority(routeImpactsForUi);
  }, [routeImpactsForUi]);

  const stormCorridorIntersect = useMemo(
    () =>
      resolveStormCorridorIntersect({
        geometry: guidanceRoute?.geometry,
        totalMeters: guidanceRouteLengthM,
        userAlongMeters:
          navigationStarted && guidanceRouteLengthM > 0 ? heavyAdvisoryAlongM : 0,
        planEtaMinutes: guidanceRoute?.baseEtaMinutes ?? null,
        driveEtaMinutes: driveEtaMinutes ?? null,
        radarSamples: radarMosaicSamples,
      }),
    [
      guidanceRoute?.geometry,
      guidanceRoute?.baseEtaMinutes,
      guidanceRouteLengthM,
      navigationStarted,
      heavyAdvisoryAlongM,
      driveEtaMinutes,
      radarMosaicSamples,
    ]
  );

  const nextHazardAtEtaLine = useMemo(
    () =>
      mergeStormCorridorAdvisoryLine(
        stormCorridorIntersect,
        routeImpactsForUi.length ? nextHazardAffectingYouLine(routeImpactsForUi) : null
      ),
    [stormCorridorIntersect, routeImpactsForUi]
  );

  /** Advisory timeline storm bands — same spans as progress strip / map route highlights. */
  const advisoryStormStripBands = useMemo(
    () =>
      routeStormStripBands.map((b) => ({
        id: b.id,
        event: b.event,
        severity: b.impactSeverity,
        startMeters: b.startMeters,
        endMeters: b.endMeters,
        expiresIso: b.expiresIso,
        onsetIso: b.onsetIso,
        alertId: b.alertId,
        crossesRoute: b.crossesRoute,
        coarsePreview: b.detailTier === "coarse",
        stripMuted: !b.stripProminent,
      })),
    [routeStormStripBands]
  );

  /**
   * Unified route-hazard timeline — progress strip bands, map highlights,
   * and progress info panel all read from this list.
   */
  const routeAheadTimeline = useMemo(() => {
    if (guidanceRouteLengthM <= 0) return [];
    const alertsById = new Map(nwsAlertsForGuidanceAdvisory.map((a) => [a.id, a]));
    return buildRouteAheadTimeline({
      routeTotalMeters: guidanceRouteLengthM,
      userAlongMeters: heavyAdvisoryAlongM,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes ?? null,
      driveEtaMinutes: driveEtaMinutes ?? null,
      stormStripBands: advisoryStormStripBands,
      routeImpacts: advisoryRouteImpacts,
      stripBandDetail: (band) => {
        const matched = band.alertId ? alertsById.get(band.alertId) : undefined;
        if (!matched) return { severityLabel: null, detail: null };
        return {
          severityLabel: matched.severity ?? null,
          detail: nwsGlanceSummary(matched) ?? null,
        };
      },
    });
  }, [
    guidanceRouteLengthM,
    heavyAdvisoryAlongM,
    guidanceRoute?.baseEtaMinutes,
    driveEtaMinutes,
    advisoryStormStripBands,
    advisoryRouteImpacts,
    nwsAlertsForGuidanceAdvisory,
  ]);

  /**
   * Progress rail + map halo: corridor NWS (incl. SWS / advisories) + radar mosaic where echo crosses.
   */
  const routeAheadWeatherBands = useMemo(() => {
    const nwsBands = timelineToProgressStripBands(routeAheadTimeline);
    const radarBands =
      showWeatherImpactsOnRoute && guidanceRouteLengthM > 0
        ? radarMosaicToProgressStripBands(guidanceRouteLengthM, radarMosaicSamples)
        : [];
    return mergeProgressStripWeatherBands([...nwsBands, ...radarBands]);
  }, [
    routeAheadTimeline,
    showWeatherImpactsOnRoute,
    guidanceRouteLengthM,
    radarMosaicSamples,
  ]);

  const routeAheadProgressBands = routeAheadWeatherBands;

  /** NWS / radar timeline bands → route outlook graph when forecast APIs are empty. */
  const stormOutlookBands = useMemo((): StormRouteOutlookBand[] => {
    return routeAheadTimeline
      .filter((item) => item.track === "nws" || item.track === "radar" || item.track === "wind")
      .map((item) => ({
        startMeters: item.startMeters,
        endMeters: item.endMeters,
        headline: [item.label, item.detailLine].filter(Boolean).join(" — "),
      }));
  }, [routeAheadTimeline]);

  /**
   * Map halo bands — same as the progress rail in Rt/Mp.
   * Drive keeps a clean blue line (no hazard casings on the polyline).
   */
  const routeAheadMapBands = useMemo(() => {
    if (viewMode === "drive") return [];
    return routeAheadWeatherBands;
  }, [routeAheadWeatherBands, viewMode]);

  /**
   * Project unified impacts back to the legacy `RouteAlert` shape so existing surfaces (progress strip,
   * map highlights, corridor sheet) keep working unchanged.
   *
   * NWS-source weather impacts are drawn elsewhere as `stormProgressBands` / map polygons, so we drop
   * them from the corridor list to avoid double-drawing the same area in two color systems.
   * Radar mosaic is route-info graph strata only — not alert cards.
   */
  const routeAlerts = useMemo(
    () =>
      routeImpactsForUi
        .filter((i) => !i.suppressFromDriveMap)
        .filter(
          (i) =>
            i.source !== "nws" &&
            i.source !== "tomorrowIo" &&
            i.source !== "windGust" &&
            i.source !== "radar"
        )
        .map(routeImpactToRouteAlert),
    [routeImpactsForUi]
  );

  const trafficBypassContext = useMemo(
    () => computeTrafficBypassOffer(routeImpactsForUi, trafficDelayMinutesForBypass),
    [routeImpactsForUi, trafficDelayMinutesForBypass]
  );

  const showTrafficBypassCta =
    TRAFFIC_BYPASS_ENABLED &&
    navigationStarted &&
    Boolean(
      mapboxToken &&
        destLngLat &&
        guidanceRoute?.geometry?.length &&
        isPlus &&
        roadAdvisoryDetailOn &&
        settingTrafficEnabled
    ) &&
    trafficBypassContext != null &&
    !trafficBypassCompare;

  /** Nav: one leg in Dr; all alternates in Rt/Mp for side-by-side compare. */
  const driveMapRoutes = useMemo(() => {
    if (trafficBypassCompare) return planRoutes;
    if (navigationStarted && offRouteHoldPreviewActive) return planRoutes;
    if (navigationStarted) {
      if (viewMode === "drive") {
        const active = planRoutes.find((r) => r.id === lockedNavigationRouteId);
        if (active) return [active];
      } else {
        return planRoutes;
      }
    }
    return planRoutes;
  }, [
    trafficBypassCompare,
    navigationStarted,
    offRouteHoldPreviewActive,
    viewMode,
    planRoutes,
    lockedNavigationRouteId,
  ]);
  const progressRailRoute = guidanceRoute ?? driveMapRoutes[0] ?? planRoutes[0];

  const postedMph =
    navigationStarted && guidanceRoute
      ? postedSpeedMphAt(guidanceRoute, userAlongGuidanceM)
      : null;

  const progressStripAlerts = useMemo(() => augmentAlertsForProgressStrip(routeAlerts), [routeAlerts]);

  return {
    alertsOnActiveRouteGeom,
    nwsAlertsAffectingActiveRoute,
    puckLngLatForNwsScan,
    stormNwsPuckInside,
    nwsAlertsForGuidanceAdvisory,
    routeStormStripAlerts,
    weatherDetailAlongM,
    routeStormStripBands,
    tioRouteHasWeather,
    showWeatherImpactsOnRoute,
    localForecastNwsAlertsRaw,
    localForecastNwsAlerts,
    stormMapGeoJsonForMap,
    routeImpacts,
    routeImpactsForUi,
    advisoryRouteImpacts,
    advisoryStormStripBands,
    routeAheadTimeline,
    routeAheadProgressBands,
    stormOutlookBands,
    routeAheadMapBands,
    routeAlerts,
    trafficBypassContext,
    showTrafficBypassCta,
    nextHazardAtEtaLine,
    stormCorridorIntersect,
    driveMapRoutes,
    progressRailRoute,
    postedMph,
    progressStripAlerts,
  };
}
