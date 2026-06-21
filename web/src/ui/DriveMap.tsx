import mapboxgl from "../mapboxCapacitorWorker";
import "mapbox-gl/dist/mapbox-gl.css";
import type { MutableRefObject } from "react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HomeMapFraming } from "../map/homeMapFraming";
import { resolveIdleHomeFraming } from "../map/homeMapFraming";
import type { HomePuckFollowMode } from "../map/homePuckFollow";
import type { TripStop } from "../nav/routeWaypoints";
import {
  markHomePreloadCompleted,
  shouldSkipHomePreloadThrottle,
} from "../map/homePreloadRegion";
import { isWifiConnection } from "../map/mapPreloadNetwork";
import { warmMapTilesForBounds } from "../map/mapRegionCacheWarm";
import {
  findMissingTripRouteLineLayers,
  ROUTE_LAYER_HEALTH_IDLE_DEBOUNCE_MS,
  ROUTE_LAYER_HEALTH_POLL_MS,
  ROUTE_LAYER_HEALTH_REPAIR_COOLDOWN_MS,
  ROUTE_LAYER_HEALTH_RETRY_MS,
} from "../map/tripRouteLayerHealth";
import type { RouteAlert } from "../nav/routeAlerts";
import type { LngLat, NavRoute } from "../nav/types";
import type { SavedPlace } from "../nav/savedPlaces";
import {
  buildCumulativeDistances,
  closestPointOnPolyline,
  closestPointOnPolylineWindowed,
  haversineMeters,
  pointAtAlongMeters,
} from "../nav/routeGeometry";
import { getWebEnv } from "../config/env";
import { mapMaxBoundsForLngLat, mapMinZoomForSession } from "../config/mapRegion";
import { isUltraLongTripRoute } from "../utils/dataSaver";
import { continentFromLngLat } from "../services/continents";
import {
  fetchRainViewerRadarFrames,
  RAINVIEWER_ANIMATION_DWELL_MS,
  tileUrlFromHostAndPath,
} from "../services/rainViewerRadar";
import { isRainViewerRateLimited, onRainViewerRateLimit, rainViewerRateLimitMsRemaining } from "../services/rainViewerTileFetch";
import {
  applyRouteConditionHighlights,
  clearRouteConditionHighlights,
  resetRouteConditionHighlightCache,
  applyRoutesToMap,
  bringRouteHitLayersToTop,
  bringRouteVisualLinesAboveTraffic,
  fitMapToOffRouteRejoinChoices,
  fitMapToRouteCompareLocal,
  fitMapToTrip,
  routeIdFromRouteHitLayerId,
  visibleRouteIdsForHitLayers,
} from "./mapRouteLayers";
import {
  applyWeatherAlertLayers,
  positionWeatherAlertLayersAboveRadar,
} from "./mapWeatherAlertLayers";
import { removeRadarMotionLayers } from "./mapRadarMotionLayer";
import {
  bringMapboxTrafficLayersToFront,
  ensureMapboxTrafficConditionLayers,
  setMapboxTrafficLayersVisible,
} from "./mapTrafficLayers";
import {
  isValidLngLat,
  isValidLngLatPair,
  readMapLngLat,
  safeEaseTo,
  safeExtendBounds,
  safeFitBounds,
  safeFlyTo,
  safePanToCenter,
  flattenMapCamera,
  safeSetMapLngLat,
  isMapUsable,
  setMapCanvasCursor,
  stopMapCamera,
} from "./mapCameraSafe";
import {
  hazardOverviewFitPadding,
  isNarrowPhoneViewport,
  mapStyleReadyForCamera,
  minPlanningRouteZoomFloor,
  offRouteAlternatesFitKey,
  planningRoutesFitKey,
  routeFitMaxZoomCeiling,
  routeFitPadding,
  routeFitZoomBias,
  ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM,
} from "./mapFitLogic";
import { driveCameraEaseOptions, smoothDriveBearingDeg } from "./mapDriveCamera";
import { liftTrafficThenRoutesThenHits } from "./mapLayerStack";
import {
  type NightBasemapPreset,
  NIGHT_MAP_STYLE_LS_KEY,
  parseNightBasemapPreset,
  currentMapPhase,
  currentMapStyle,
  sceneLightForPhase,
  buildingColorForPhase,
} from "./mapBasemapStyle";
import {
  TOPDOWN_PUCK_OFFSET_PX,
  TOPDOWN_NAV_STREET_ZOOM,
  TOPDOWN_NAV_MIN_ZOOM,
  ROUTE_VIEW_PLANNING_STREET_ZOOM,
  resolveTopdownLocalZoom,
  coerceTopdownNavStreetZoom,
  regionalPlanningZoom,
} from "./mapTopdownCamera";
import { selectablePoiAtPoint } from "./mapPoiPick";
import { mapEventFromUser, setDriveMapUserGestures } from "./mapDriveGestures";
import {
  makePuckEl,
  makeDestEl,
  makeViaStopEl,
  makePoiHoverEl,
  makeBypassHazardEl,
} from "./mapMarkerDom";
import { useMapGeoJsonOverlays } from "./useMapGeoJsonOverlays";
import { useStormNwsHoverPopup } from "./useStormNwsHoverPopup";
import { driveMapPropsAreEqual } from "./driveMapPropsAreEqual";
import {
  animateRainViewerDualCrossfade,
  ensureRainViewerRadarDual,
  RAINVIEWER_RADAR_CROSSFADE_MS,
  RAINVIEWER_RADAR_VISIBLE_OPACITY,
  positionRainViewerRadarUnderRoads,
  removeRainViewerRadar,
  setRainViewerRadarTilesOnSource,
  setRainViewerRadarLayersVisible,
  waitForRainViewerSideLoaded,
} from "./mapRadarLayer";
import { applyNightBasemapReadability } from "./mapNightBasemapReadability";

import { safeStorage } from "../storage/safeStorage";
import { reportAppHealthSignal } from "../monitoring/appHealthSignals";

import type { MapFocusRequest, MapViewMode } from "./driveMapTypes";
import { MAIN_MAP_ROUTE_PADDING } from "./driveMapTypes";
export type { MapFocusRequest, MapViewMode };
export { MAIN_MAP_ROUTE_PADDING };

/**
 * Planning/browse modes: keep manual pan/zoom control much longer before auto-recenter so
 * users can freely browse far away areas (other countries/continents) without snap-back.
 */
const EXPLORE_IDLE_MS = 120_000;

export type Props = {
  routes: NavRoute[];
  lineFocusId: string;
  suggestedRouteId: string | null;
  userLngLat: [number, number] | null;
  destLngLat: [number, number] | null;
  /** Numbered markers for intermediate stops (before final destination). */
  viaStops?: TripStop[];
  fitTrigger: number;
  viewMode: MapViewMode;
  navigationStarted: boolean;
  heading: number | null;
  /** When set (drive + active leg), camera bearing follows the polyline ahead instead of GPS heading. */
  driveRouteBearingDeg?: number | null;
  /** Ground speed from Geolocation; used to tighten puck smoothing while moving. */
  speedMps?: number | null;
  allowDestinationPick: boolean;
  topdownZoomRef: MutableRefObject<number>;
  onMapClick: (lng: number, lat: number) => void;
  savedPlaces: SavedPlace[];
  savedPlacesVisible: boolean;
  onSavedPlaceClick: (id: string) => void;
  mapFocus: MapFocusRequest | null;
  onMapFocusComplete: () => void;
  /** A / B / C order — same as route picker */
  orderedRouteIds: string[];
  showRadar: boolean;
  /** When false, show the latest radar frame only (no dual-layer animation — saves data). */
  radarAnimate?: boolean;
  /** RainViewer frame `time` (unix seconds, UTC instant) for the mosaic shown, or null when radar is off / unavailable. */
  onRadarFrameUtcSec?: (utcSec: number | null) => void;
  /** Same corridor points as the progress-strip ticks (weather, notices) — drawn on the active route line. */
  alongRouteAlerts?: RouteAlert[];
  /**
   * Polyline for those corridor overlays — must match the geometry used to build {@link alongRouteAlerts}
   * (active guidance leg). When omitted, falls back to `routes.find(lineFocusId)?.geometry`.
   */
  corridorRouteGeometry?: LngLat[] | null;
  /** NWS storm spans along the route line — same bands as the progress strip. */
  stormAlongRouteBands?: import("../weatherAlerts/geometryOverlap").StormProgressStripBand[];
  /** Live GPS path while “Record driven path” is active (dashed line + rubber-band to current position). */
  recordingGeometry?: LngLat[];
  /** US NWS warning polygons (GeoJSON), when storm advisory is on */
  weatherAlertGeoJson?: GeoJSON.FeatureCollection | null;
  /** Storm UI under guidance — extra top inset for route fit + drive camera. */
  stormBarVisible?: boolean;
  /** Full storm bar expanded (vs left peek only). */
  stormBarExpanded?: boolean;
  /** Bumps when user taps “My location” in route planning (no trip yet). */
  recenterPlanningPuckTick?: number;
  /** While navigating, smooth the puck along this polyline (closest point) when GPS is near the line. */
  puckSnapGeometry?: LngLat[] | null;
  /**
   * Best-known along-route distance (meters) for the user — used to seed the puck snap window so
   * the first closest-point search doesn't scan the full geometry and risk latching onto a parallel
   * segment far ahead of the user's real position.
   */
  snapSeedMeters?: number | null;
  /** Along-route meters on the active leg — drives drive-mode route line slicing. */
  userAlongMeters?: number | null;
  /** Colored road traffic (Mapbox traffic-v1); mirrors Hazards → Road & traffic checkbox. */
  trafficConditionsOnMap?: boolean;
  /** Drive mode: live map bearing (degrees) for a north-fixed compass in the chrome. */
  onDriveCameraBearingDeg?: (deg: number | null) => void;
  /** When set with {@link onStormBrowseBoundsChange}, reports visible bounds for viewport NWS fetches (browse, no route). */
  stormBrowseBoundsReporting?: boolean;
  onStormBrowseBoundsChange?: (bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  }) => void;
  /** Traffic bypass compare: show all A/B/C legs with picker styling (no map ETA flags). */
  trafficBypassCompareActive?: boolean;
  /**
   * Hazard the user is being asked to plan around — drives the on-map pin and compare camera fit.
   */
  trafficBypassCompareHazardLngLat?: LngLat | null;
  /** M along the primary leg for the compare hazard — tightens local fit ahead of the jam. */
  trafficBypassCompareHazardAlongMeters?: number | null;
  /** Locked route at Go — off-route compare fit keeps A local while framing B/C. */
  rejoinCompareLockedRouteId?: string | null;
  /** Plus: sparse GPS dots over weeks/months (see About → Activity trail). */
  activityTrailGeoJson?: GeoJSON.FeatureCollection | null;
  /** Active guidance leg length (m) — zoom floors + cross-country perf. */
  sessionRouteLengthM?: number;
  /**
   * Plus + learn: SW/NE corners covering stored activity — with user position, frames route planning before a destination.
   */
  activityTrailPlanningBounds?: [[number, number], [number, number]] | null;
  /** Plus: launch / idle map framing preference (Basic always my_location). */
  idleHomeMapFraming?: HomeMapFraming;
  /** Home screen (no trip): center puck on GPS vs free map exploration. */
  homePuckFollow?: HomePuckFollowMode;
  /** User panned/zoomed on the home screen — release follow until My location. */
  onHomeMapUserPan?: () => void;
  /** Plus + learn: Wi‑Fi tile cache warm over density-capped home region. */
  homePreloadEnabled?: boolean;
  homePreloadBounds?: [[number, number], [number, number]] | null;
  /** Multi-result destination search: temporary pins until the user picks one. */
  searchPickMarkers?: { id: string; lngLat: LngLat; label: string }[] | null;
  onSearchPickMarkerClick?: (id: string) => void;
  /** Right-side route progress rail visibility affects camera/right padding. */
  progressRailVisible?: boolean;
  /** Off-route Mp: fit B/C rejoin paths in view instead of street-level puck follow. */
  offRouteRejoinCompareActive?: boolean;
};

/** Drive mode: return to follow-cam after the user pans/zooms the map. */
const DRIVE_EXPLORE_IDLE_MS = 10_000;
/** ~1/e time constant (seconds) for drive camera bearing toward route/GPS heading (rAF loop). */
const DRIVE_CAMERA_BEARING_TC_S = 0.58;
/** Delay before Wi‑Fi tile warm so idle-home camera can finish first. */
const HOME_PRELOAD_START_DELAY_MS = 4_500;

/**
 * Drive (3D) view: lateral balance comes from symmetric horizontal padding in
 * {@link driveCameraEaseOptions} (portrait); marker stays on the route line.
 */
const DRIVE_PUCK_MARKER_OFFSET_PX: [number, number] = [0, 0];

const ZERO_MAP_PADDING: mapboxgl.PaddingOptions = { top: 0, bottom: 0, left: 0, right: 0 };

const SAVED_PLACE_DOT_MIN_ZOOM = 7;
const SAVED_PLACE_DOT_FULL_ZOOM = 12.5;
const SAVED_PLACE_DOT_MIN_SIZE_PX = 5;
const SAVED_PLACE_DOT_FULL_SIZE_PX = 14;

function savedPlaceDotSizeForZoom(zoom: number): { sizePx: number; borderPx: number } {
  const t = Math.max(
    0,
    Math.min(1, (zoom - SAVED_PLACE_DOT_MIN_ZOOM) / (SAVED_PLACE_DOT_FULL_ZOOM - SAVED_PLACE_DOT_MIN_ZOOM))
  );
  return {
    sizePx: SAVED_PLACE_DOT_MIN_SIZE_PX + (SAVED_PLACE_DOT_FULL_SIZE_PX - SAVED_PLACE_DOT_MIN_SIZE_PX) * t,
    borderPx: 1 + t,
  };
}

function DriveMapInner({
  routes,
  lineFocusId,
  suggestedRouteId,
  userLngLat,
  destLngLat,
  viaStops = [],
  fitTrigger,
  viewMode,
  navigationStarted,
  heading,
  driveRouteBearingDeg = null,
  speedMps = null,
  allowDestinationPick,
  topdownZoomRef,
  onMapClick,
  savedPlaces,
  savedPlacesVisible,
  onSavedPlaceClick,
  mapFocus,
  onMapFocusComplete,
  orderedRouteIds,
  showRadar,
  radarAnimate = true,
  onRadarFrameUtcSec,
  alongRouteAlerts,
  corridorRouteGeometry = null,
  stormAlongRouteBands,
  recordingGeometry,
  weatherAlertGeoJson,
  stormBarVisible = false,
  stormBarExpanded = true,
  recenterPlanningPuckTick = 0,
  puckSnapGeometry = null,
  snapSeedMeters = null,
  userAlongMeters = null,
  trafficConditionsOnMap = false,
  onDriveCameraBearingDeg,
  stormBrowseBoundsReporting = false,
  onStormBrowseBoundsChange,
  trafficBypassCompareActive = false,
  trafficBypassCompareHazardLngLat = null,
  trafficBypassCompareHazardAlongMeters = null,
  rejoinCompareLockedRouteId = null,
  activityTrailGeoJson = null,
  sessionRouteLengthM = 0,
  activityTrailPlanningBounds = null,
  idleHomeMapFraming = "my_location",
  homePuckFollow = "explore",
  onHomeMapUserPan,
  homePreloadEnabled = false,
  homePreloadBounds = null,
  searchPickMarkers = null,
  onSearchPickMarkerClick,
  progressRailVisible = true,
  offRouteRejoinCompareActive = false,
}: Props) {
  const ultraLongRoute = isUltraLongTripRoute(sessionRouteLengthM);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const puckMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const viaMarkerMapRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  const poiHoverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const bypassHazardMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const savedMarkerMapRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement }>>(new Map());
  const onSavedClickRef = useRef(onSavedPlaceClick);
  onSavedClickRef.current = onSavedPlaceClick;
  const searchPickMarkerMapRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement }>>(new Map());
  const onSearchPickMarkerClickRef = useRef(onSearchPickMarkerClick);
  onSearchPickMarkerClickRef.current = onSearchPickMarkerClick;
  const routeIdsRef = useRef<Set<string>>(new Set());
  /** Re-apply A/B/C route lines — shared by sync effect and map layer health watch. */
  const syncTripRoutesRef = useRef<() => boolean>(() => false);
  const routeLayerHealthRepairAtRef = useRef(0);
  const prevTopdownRef = useRef(false);
  const topdownSnapKeyRef = useRef("");
  const prevNavigationStartedRef = useRef(false);
  const wasRouteCompareRef = useRef(false);
  const onClickRef = useRef(onMapClick);
  onClickRef.current = onMapClick;
  const userLngLatRef = useRef(userLngLat);
  userLngLatRef.current = userLngLat;
  const puckSnapGeomRef = useRef<LngLat[] | null>(null);
  puckSnapGeomRef.current =
    navigationStarted && puckSnapGeometry && puckSnapGeometry.length >= 2 ? puckSnapGeometry : null;
  const snapSeedMetersRef = useRef<number | null>(null);
  snapSeedMetersRef.current = (snapSeedMeters != null && Number.isFinite(snapSeedMeters) && snapSeedMeters >= 0)
    ? snapSeedMeters : null;
  const userAlongMetersRef = useRef<number | null>(null);
  userAlongMetersRef.current =
    userAlongMeters != null && Number.isFinite(userAlongMeters) && userAlongMeters >= 0
      ? userAlongMeters
      : null;
  /** Throttle map hazard-halo clip refreshes — full corridor reslice was blocking UI on long routes. */
  const lastHighlightClipAlongRef = useRef<number | null>(null);
  const [highlightClipTick, setHighlightClipTick] = useState(0);
  useEffect(() => {
    if (!navigationStarted || viewMode !== "drive") return;
    const along = userAlongMeters ?? 0;
    const last = lastHighlightClipAlongRef.current;
    if (last != null && Math.abs(along - last) < 450) return;
    lastHighlightClipAlongRef.current = along;
    const t = window.setTimeout(() => setHighlightClipTick((n) => n + 1), 280);
    return () => window.clearTimeout(t);
  }, [userAlongMeters, navigationStarted, viewMode]);
  const lastDriveRouteLineSyncAlongRef = useRef<number | null>(null);
  const speedMpsRef = useRef<number | null>(null);
  speedMpsRef.current = speedMps;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const navigationStartedRef = useRef(navigationStarted);
  navigationStartedRef.current = navigationStarted;
  const routesLengthRef = useRef(routes.length);
  routesLengthRef.current = routes.length;
  const homePuckFollowRef = useRef(homePuckFollow);
  homePuckFollowRef.current = homePuckFollow;
  const onHomeMapUserPanRef = useRef(onHomeMapUserPan);
  onHomeMapUserPanRef.current = onHomeMapUserPan;
  const userExploringRef = useRef(false);
  /** One-shot: force drive follow-cam easeTo even when the puck barely moved (explore end, layout, resume). */
  const driveCamResyncRef = useRef(false);
  const exploreTimerRef = useRef<number | null>(null);
  const lastForcedPlanningFitTriggerRef = useRef<number | null>(null);
  const prevPlanningRouteCountRef = useRef(0);
  const planningFitRafRef = useRef<number | null>(null);
  const planningFitRetryTimerRef = useRef<number | null>(null);
  const planningFitVerifyTimerRef = useRef<number | null>(null);
  const activeDriveCamera = navigationStarted && viewMode === "drive";
  const idleHomeScreen = routes.length === 0 && !navigationStarted;
  const topdownFollowKey = userLngLat
    ? `${Math.round(userLngLat[0] * 2500)}|${Math.round(userLngLat[1] * 2500)}`
    : null;
  const idleHomeFollowKey =
    idleHomeScreen && homePuckFollow === "follow" && userLngLat
      ? `${Math.round(userLngLat[0] * 2500)}|${Math.round(userLngLat[1] * 2500)}`
      : null;

  useEffect(() => {
    if (routes.length === 0) prevPlanningRouteCountRef.current = 0;
  }, [routes.length]);
  const driveCamBearingSmoothedRef = useRef<number | null>(null);
  /** User-chosen zoom while navigating in Dr — do not snap back to 16.35 after pinch. */
  const driveNavZoomRef = useRef(16.35);
  const navRouteSnapKeyRef = useRef("");
  const prevPlanningViewModeRef = useRef(viewMode);
  /** Reuse stable padding/offset for drive follow — fresh objects every frame can confuse Mapbox camera updates. */
  const driveCamEaseOptsCacheRef = useRef<{
    key: string;
    padding: mapboxgl.PaddingOptions;
    offset: [number, number];
  } | null>(null);
  const onMapFocusCompleteRef = useRef(onMapFocusComplete);
  onMapFocusCompleteRef.current = onMapFocusComplete;
  const onRadarFrameUtcSecRef = useRef(onRadarFrameUtcSec);
  onRadarFrameUtcSecRef.current = onRadarFrameUtcSec;
  const onDriveCameraBearingDegRef = useRef(onDriveCameraBearingDeg);
  onDriveCameraBearingDegRef.current = onDriveCameraBearingDeg;
  const onStormBrowseBoundsRef = useRef(onStormBrowseBoundsChange);
  onStormBrowseBoundsRef.current = onStormBrowseBoundsChange;
  const routesForHitRef = useRef({ routes, lineFocusId, viewMode });
  routesForHitRef.current = { routes, lineFocusId, viewMode };

  const headingRef = useRef(heading);
  headingRef.current = heading;
  const driveRouteBearingDegRef = useRef(driveRouteBearingDeg);
  driveRouteBearingDegRef.current = driveRouteBearingDeg;
  const stormBarVisibleRef = useRef(stormBarVisible);
  stormBarVisibleRef.current = stormBarVisible;
  const stormBarExpandedRef = useRef(stormBarExpanded);
  stormBarExpandedRef.current = stormBarExpanded;
  const progressRailVisibleRef = useRef(progressRailVisible);
  progressRailVisibleRef.current = progressRailVisible;
  const sessionRouteLengthMRef = useRef(sessionRouteLengthM);
  sessionRouteLengthMRef.current = sessionRouteLengthM;

  const routesPlanningFitKey = useMemo(
    () => planningRoutesFitKey(routes, lineFocusId, destLngLat),
    [routes, lineFocusId, destLngLat]
  );

  const token = getWebEnv().mapboxToken;
  const mapSessionBounds = useMemo(
    () => mapMaxBoundsForLngLat(userLngLat),
    [userLngLat?.[0], userLngLat?.[1]]
  );
  const mapHasContinent = useMemo(
    () => continentFromLngLat(userLngLat) != null,
    [userLngLat?.[0], userLngLat?.[1]]
  );
  const [mapReady, setMapReady] = useState(false);
  const [mapResumeTick, setMapResumeTick] = useState(0);

  /** After pan/zoom ends, refresh halo clip once follow resumes. */
  useEffect(() => {
    if (!navigationStarted || viewMode !== "drive" || mapResumeTick === 0) return;
    lastHighlightClipAlongRef.current = null;
    setHighlightClipTick((n) => n + 1);
  }, [mapResumeTick, navigationStarted, viewMode]);

  /** Bumps when bottom/top chrome resizes so route fit padding tracks live UI dead zones. */
  const [chromeLayoutTick, setChromeLayoutTick] = useState(0);
  const [nightBasemapPreset] = useState<NightBasemapPreset>(parseNightBasemapPreset);
  const [mapPhase, setMapPhase] = useState(currentMapPhase);
  const activeStyleRef = useRef(currentMapStyle(mapPhase, nightBasemapPreset));
  const trafficConditionsOnMapRef = useRef(trafficConditionsOnMap);
  trafficConditionsOnMapRef.current = trafficConditionsOnMap;

  const beginUserExploreRef = useRef<() => void>(() => {});
  const scheduleExploreEndRef = useRef<() => void>(() => {});
  beginUserExploreRef.current = () => {
    userExploringRef.current = true;
    if (exploreTimerRef.current) {
      clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = null;
    }
  };
  scheduleExploreEndRef.current = () => {
    if (exploreTimerRef.current) window.clearTimeout(exploreTimerRef.current);
    const idleHomeExplore =
      !navigationStartedRef.current &&
      routesLengthRef.current === 0 &&
      homePuckFollowRef.current === "explore";
    if (idleHomeExplore) {
      /* Home explore: still release the interaction lock so route overlays clear after a trip ends. */
      exploreTimerRef.current = window.setTimeout(() => {
        userExploringRef.current = false;
        exploreTimerRef.current = null;
        setMapResumeTick((n) => n + 1);
      }, 800);
      return;
    }
    const idleMs =
      routesLengthRef.current === 0
        ? 400
        : navigationStartedRef.current && viewModeRef.current === "drive"
          ? DRIVE_EXPLORE_IDLE_MS
          : EXPLORE_IDLE_MS;
    exploreTimerRef.current = window.setTimeout(() => {
      userExploringRef.current = false;
      exploreTimerRef.current = null;
      if (navigationStartedRef.current && viewModeRef.current === "drive") {
        driveCamResyncRef.current = true;
      }
      setMapResumeTick((n) => n + 1);
    }, idleMs);
  };

  useLayoutEffect(() => {
    const bottomStack = document.querySelector<HTMLElement>(".nav-bottom-stack");
    const topCluster = document.querySelector<HTMLElement>(".nav-top-cluster");
    if (!bottomStack && !topCluster) return;

    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setChromeLayoutTick((n) => n + 1));
    };

    const ro = new ResizeObserver(bump);
    if (bottomStack) ro.observe(bottomStack);
    if (topCluster) ro.observe(topCluster);
    window.addEventListener("resize", bump);
    window.addEventListener("orientationchange", bump);
    bump();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", bump);
      window.removeEventListener("orientationchange", bump);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !token || mapRef.current) return;

    mapboxgl.accessToken = token;
    activeStyleRef.current = currentMapStyle(currentMapPhase(), nightBasemapPreset);

    /* Wrap construction in try/catch so any runtime error in mapboxgl.Map is logged
     * rather than left as a silent React effect failure. */
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: activeStyleRef.current,
        center: [-98.5, 39.8],
        zoom: 4,
        attributionControl: false,
        dragRotate: true,
        touchPitch: true,
        scrollZoom: true,
        dragPan: true,
        touchZoomRotate: true,
        boxZoom: true,
        doubleClickZoom: true,
      });
    } catch (e) {
      console.error("[map] constructor threw", e);
      return;
    }
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    mapRef.current = map;

    /* Keep pan/zoom inside the user's continent once GPS is available (see mapRegion effect). */
    map.setMaxBounds(mapSessionBounds);
    map.setMinZoom(
      mapMinZoomForSession({
        navigationStarted: navigationStartedRef.current,
        hasContinent: mapHasContinent,
        ultraLongRoute: isUltraLongTripRoute(sessionRouteLengthMRef.current),
      })
    );

    /* Force Mercator projection. mapbox-gl 3.x defaults to globe at zoom < 6 (our
     * initial zoom is 4), and globe projection on Capacitor's WebKit/WebGL2 context
     * never completes a frame — the map renders only the atmosphere ring with no
     * continents drawn. Mercator is also how every classic nav app (Apple Maps,
     * Google Maps mobile, Waze) renders; globe was a desktop showpiece, not a fit
     * for in-car nav. We set it on style.load (rather than constructor opts) because
     * some Mapbox style JSONs include a `projection` field that would override the
     * constructor setting. */
    map.on("style.load", () => {
      try {
        (map as unknown as { setProjection: (p: string) => void }).setProjection("mercator");
      } catch { /* setProjection not available on this gl version — fine */ }
      resetRouteConditionHighlightCache(map);
    });
    map.on("error", (e: { error?: unknown }) => {
      console.warn("[map] mapbox-gl error", e?.error ?? e);
    });

    const installTrafficLayers = () => {
      try {
        ensureMapboxTrafficConditionLayers(map);
        setMapboxTrafficLayersVisible(map, trafficConditionsOnMapRef.current);
      } catch (err) {
        console.warn("[traffic-map] add traffic failed:", err);
      }
    };
    map.on("style.load", installTrafficLayers);

    const bumpResize = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            map.resize();
          } catch {
            /* style teardown */
          }
        });
      });
    };

    const onLoad = () => {
      setMapReady(true);
      bumpResize();
      installTrafficLayers();
    };
    if (map.isStyleLoaded()) {
      setMapReady(true);
      bumpResize();
      installTrafficLayers();
    } else map.once("load", onLoad);

    return () => {
      map.off("style.load", installTrafficLayers);
      map.off("load", onLoad);
      puckMarkerRef.current?.remove();
      puckMarkerRef.current = null;
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      routeIdsRef.current = new Set();
      if (exploreTimerRef.current) clearTimeout(exploreTimerRef.current);
    };
  }, [token]);

  useEffect(() => {
    safeStorage.set(NIGHT_MAP_STYLE_LS_KEY, nightBasemapPreset);
  }, [nightBasemapPreset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !stormBrowseBoundsReporting || !onStormBrowseBoundsChange) return;

    let debounceTimer: number | null = null;

    const emit = () => {
      try {
        if (!map.isStyleLoaded()) return;
        const bounds = map.getBounds();
        if (!bounds) return;
        onStormBrowseBoundsRef.current?.({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        });
      } catch {
        /* map teardown */
      }
    };

    const debounced = () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        emit();
      }, 680);
    };

    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    requestAnimationFrame(() => {
      requestAnimationFrame(emit);
    });

    return () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      map.off("moveend", debounced);
      map.off("zoomend", debounced);
    };
  }, [mapReady, stormBrowseBoundsReporting, onStormBrowseBoundsChange]);

  useEffect(() => {
    const id = window.setInterval(() => setMapPhase(currentMapPhase()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    if (mapPhase !== "night" || nightBasemapPreset === "streets") return;
    const reliftRoutes = () => {
      const { routes: rts, lineFocusId: lid, viewMode: vm } = routesForHitRef.current;
      if (rts.length === 0) return;
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(rts, lid, vm, false)
      );
    };
    const apply = () => {
      try {
        applyNightBasemapReadability(map);
        reliftRoutes();
      } catch {
        /* style race */
      }
    };
    requestAnimationFrame(apply);
    const t = window.setTimeout(apply, 120);
    const t2 = window.setTimeout(apply, 450);
    const t3 = window.setTimeout(apply, 1200);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [mapPhase, mapReady, nightBasemapPreset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const reliftRoutes = () => {
      const { routes: rts, lineFocusId: lid, viewMode: vm } = routesForHitRef.current;
      if (rts.length === 0) return;
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(rts, lid, vm, false)
      );
    };
    const apply = () => {
      try {
        ensureMapboxTrafficConditionLayers(map);
        setMapboxTrafficLayersVisible(map, trafficConditionsOnMap);
        reliftRoutes();
      } catch {
        /* style race */
      }
    };
    apply();
    /* Layers can appear one frame after style load — retry so visibility matches the toggle. */
    const t = window.setTimeout(apply, 0);
    const t2 = window.setTimeout(apply, 120);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [trafficConditionsOnMap, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = currentMapStyle(mapPhase, nightBasemapPreset);
    if (want === activeStyleRef.current) return;
    activeStyleRef.current = want;
    setMapReady(false);
    /* Keep prev route ids so applyRoutesToMap can remove layers after style reload; clearing the ref
       caused ghost polylines if the trip was cleared before routes re-synced. */
    map.setStyle(want);
    const onStyle = () => setMapReady(true);
    map.once("style.load", onStyle);
    return () => { map.off("style.load", onStyle); };
  }, [mapPhase, nightBasemapPreset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getSource("mapbox-dem")) return;

    map.addSource("mapbox-dem", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

    if (!map.getLayer("3d-buildings")) {
      const layers = map.getStyle()?.layers ?? [];
      let labelLayerId: string | undefined;
      for (const layer of layers) {
        if (layer.type === "symbol" && (layer.layout as Record<string, unknown>)?.["text-field"]) {
          labelLayerId = layer.id;
          break;
        }
      }
      map.addLayer(
        {
          id: "3d-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": buildingColorForPhase(mapPhase),
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.6,
          },
        },
        labelLayerId
      );
    }
  }, [mapReady, mapPhase]);

  /** Keep 3D building color in sync when phase changes after the layer is already live. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!map.getLayer("3d-buildings")) return;
    try {
      map.setPaintProperty("3d-buildings", "fill-extrusion-color", buildingColorForPhase(mapPhase));
    } catch { /* layer not ready */ }
  }, [mapReady, mapPhase]);

  /** Day vs night: sun position and intensity for 3D buildings. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    try {
      map.setLight(sceneLightForPhase(mapPhase));
    } catch { /* style race */ }
  }, [mapReady, mapPhase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const lockDriveNav = navigationStarted && viewMode === "drive";
    setDriveMapUserGestures(map, !lockDriveNav);
    if (lockDriveNav) {
      userExploringRef.current = false;
      if (exploreTimerRef.current) {
        clearTimeout(exploreTimerRef.current);
        exploreTimerRef.current = null;
      }
    }
  }, [mapReady, navigationStarted, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const dragstart = (e: unknown) => {
      if (mapEventFromUser(e)) beginUserExploreRef.current();
    };
    const dragend = (e: unknown) => {
      if (mapEventFromUser(e)) scheduleExploreEndRef.current();
    };
    const zoomstart = (e: unknown) => {
      if (mapEventFromUser(e)) beginUserExploreRef.current();
    };
    const zoomend = (e: unknown) => {
      if (!mapEventFromUser(e)) return;
      scheduleExploreEndRef.current();
      try {
        const z = map.getZoom();
        if (navigationStartedRef.current && viewModeRef.current === "drive") {
          driveNavZoomRef.current = z;
        }
        if (viewModeRef.current === "topdown") {
          topdownZoomRef.current = z;
        }
      } catch {
        /* map torn down */
      }
    };
    const rotatestart = (e: unknown) => {
      if (mapEventFromUser(e)) beginUserExploreRef.current();
    };
    const rotateend = (e: unknown) => {
      if (mapEventFromUser(e)) scheduleExploreEndRef.current();
    };
    /** Pinch / two-finger pan on iOS often surfaces as move* rather than drag* alone. */
    const movestart = (e: unknown) => {
      if (mapEventFromUser(e)) beginUserExploreRef.current();
    };
    const moveend = (e: unknown) => {
      if (mapEventFromUser(e)) scheduleExploreEndRef.current();
    };

    map.on("dragstart", dragstart);
    map.on("dragend", dragend);
    map.on("zoomstart", zoomstart);
    map.on("zoomend", zoomend);
    map.on("rotatestart", rotatestart);
    map.on("rotateend", rotateend);
    map.on("movestart", movestart);
    map.on("moveend", moveend);
    return () => {
      map.off("dragstart", dragstart);
      map.off("dragend", dragend);
      map.off("zoomstart", zoomstart);
      map.off("zoomend", zoomend);
      map.off("rotatestart", rotatestart);
      map.off("rotateend", rotateend);
      map.off("movestart", movestart);
      map.off("moveend", moveend);
      if (exploreTimerRef.current) clearTimeout(exploreTimerRef.current);
    };
  }, [mapReady]);

  /** Limit zoom-out / pan to the continent of the current GPS fix (US+CA+MX share NA). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      map.setMaxBounds(mapSessionBounds);
      map.setMinZoom(
        mapMinZoomForSession({
          navigationStarted,
          hasContinent: mapHasContinent,
          ultraLongRoute,
        })
      );
    } catch {
      /* map disposed */
    }
  }, [mapReady, mapSessionBounds, navigationStarted, mapHasContinent, ultraLongRoute]);

  /** Mobile: URL bar / rotation / safe-area change the map container — Mapbox must resize or the canvas stays wrong and the puck can disappear. */
  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !mapReady || !el) return;

    const resize = () => {
      try {
        map.resize();
      } catch {
        /* teardown */
      }
    };

    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", resize);
    vv?.addEventListener("scroll", resize);
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    resize();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      vv?.removeEventListener("resize", resize);
      vv?.removeEventListener("scroll", resize);
      ro.disconnect();
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !mapFocus) return;

    beginUserExploreRef.current();

    if (mapFocus.kind === "polygonFit") {
      // Fit to the NWS polygon bounding box with extra padding to show surrounding context.
      if (!isValidLngLatPair(mapFocus.sw) || !isValidLngLatPair(mapFocus.ne)) return;
      const b = new mapboxgl.LngLatBounds(mapFocus.sw, mapFocus.ne);
      safeFitBounds(map, b, {
        padding: hazardOverviewFitPadding(),
        duration: 1100,
        maxZoom: 9,
        pitch: 0,
        bearing: 0,
        essential: true,
      });
    } else if (mapFocus.kind === "hazardEvent") {
      if (!isValidLngLat(mapFocus.hazardLng, mapFocus.hazardLat)) return;
      safeFlyTo(map, {
        center: [mapFocus.hazardLng, mapFocus.hazardLat],
        zoom: mapFocus.zoom ?? 11.5,
        duration: 950,
        pitch: 0,
        bearing: 0,
        essential: true,
      });
    } else if (mapFocus.kind === "hazardOverview") {
      const b = new mapboxgl.LngLatBounds();
      safeExtendBounds(b, [mapFocus.hazardLng, mapFocus.hazardLat]);
      if (userLngLatRef.current) safeExtendBounds(b, userLngLatRef.current);
      if (destLngLat) safeExtendBounds(b, destLngLat);
      for (const r of routes) {
        for (const pt of r.geometry) {
          safeExtendBounds(b, pt as [number, number]);
        }
      }
      safeFitBounds(map, b, {
        padding: hazardOverviewFitPadding(),
        duration: 1100,
        maxZoom: 12.8,
        pitch: 0,
        bearing: 0,
        essential: true,
      });
    } else {
      if (!isValidLngLat(mapFocus.lng, mapFocus.lat)) return;
      safeFlyTo(map, {
        center: [mapFocus.lng, mapFocus.lat],
        zoom: mapFocus.zoom ?? 12.8,
        duration: 950,
        essential: true,
      });
    }
    map.once("moveend", () => scheduleExploreEndRef.current());
    onMapFocusCompleteRef.current();
    return () => {
      if (!userExploringRef.current) stopMapCamera(map);
    };
  }, [mapReady, mapFocus, routes, destLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const click = (e: mapboxgl.MapMouseEvent) => {
      /* Consume taps on the route corridor so they don’t move the destination pin; hazard details are via Hazards + progress strip. */
      if (routes.length > 0) {
        const hideAltsOnMainDrive = viewMode === "drive";
        const hitLayerIds = routes
          .filter((r) => !hideAltsOnMainDrive || r.id === lineFocusId)
          .map((r) => `route-${r.id}-line-hit`)
          .filter((lid) => map.getLayer(lid));
        if (hitLayerIds.length > 0) {
          const feats = map.queryRenderedFeatures(e.point, { layers: hitLayerIds });
          const lid = feats[0]?.layer?.id;
          if (lid && routeIdFromRouteHitLayerId(lid)) {
            return;
          }
        }
      }

      if (!allowDestinationPick) return;
      const poi = selectablePoiAtPoint(map, e.point);
      if (poi) {
        onClickRef.current(poi.lngLat[0], poi.lngLat[1]);
        return;
      }
      const clickLngLat = readMapLngLat(e.lngLat);
      if (!clickLngLat) return;
      onClickRef.current(clickLngLat[0], clickLngLat[1]);
    };
    map.on("click", click);
    return () => {
      map.off("click", click);
    };
  }, [mapReady, allowDestinationPick, routes, lineFocusId, navigationStarted, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const clearHover = () => {
      setMapCanvasCursor(map, "");
      poiHoverMarkerRef.current?.remove();
      poiHoverMarkerRef.current = null;
    };

    const mousemove = (e: mapboxgl.MapMouseEvent) => {
      if (!allowDestinationPick) {
        clearHover();
        return;
      }
      const poi = selectablePoiAtPoint(map, e.point);
      if (!poi) {
        clearHover();
        return;
      }
      setMapCanvasCursor(map, "pointer");
      if (!poiHoverMarkerRef.current) {
        poiHoverMarkerRef.current = new mapboxgl.Marker({
          element: makePoiHoverEl(),
          anchor: "center",
        }).addTo(map);
      }
      poiHoverMarkerRef.current &&
        safeSetMapLngLat(poiHoverMarkerRef.current, poi.lngLat) &&
        poiHoverMarkerRef.current.getElement().setAttribute("aria-label", poi.label);
    };

    map.on("mousemove", mousemove);
    map.on("mouseleave", clearHover);
    return () => {
      map.off("mousemove", mousemove);
      map.off("mouseleave", clearHover);
      clearHover();
    };
  }, [mapReady, allowDestinationPick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !userLngLat) return;

    /* While navigating, the RAF loop owns puck motion — skip so GPS ticks do not re-run flyTo logic (dev gets many re-renders). */
    if (navigationStarted && puckMarkerRef.current) {
      return;
    }

    if (!puckMarkerRef.current) {
      puckMarkerRef.current = new mapboxgl.Marker({
        element: makePuckEl(),
        anchor: "center",
        pitchAlignment: "map",
        rotationAlignment: "map",
      })
        .setLngLat(userLngLat)
        .addTo(map);
    } else if (!navigationStarted) {
      puckMarkerRef.current.setLngLat(userLngLat);
    }
  }, [mapReady, userLngLat, routes.length, navigationStarted]);

  useEffect(() => {
    if (!navigationStarted || !mapReady) return;
    const marker = puckMarkerRef.current;
    if (!marker) return;
    const t0 = userLngLatRef.current;
    if (t0) marker.setLngLat(t0);

    let raf = 0;
    let lastTs = performance.now();
    /** Hysteresis: snap in when close, stay snapped until clearly off-route — avoids jitter at the threshold. */
    const SNAP_IN_M = 88;
    const SNAP_OUT_M = 118;
    const SNAP_BACK_M  = 500;   // how far behind last snap to search (handles reversing / u-turn)
    const SNAP_AHEAD_M = 3500;  // how far ahead to search (fast freeway ~60 s worth at 200 km/h)
    let snapLatched = false;
    let lastGeomKey = "";
    let snapRouteTotalM = 0;
    /** Pre-built cumulative distances for the current snap geometry — built once per geometry change. */
    let snapCumDist: Float64Array | null = null;
    /** Low-pass `alongMeters` while snapped — closest-point slides along vertices every frame otherwise. */
    let snappedAlongSmooth: number | null = null;

    // GPS fix history for constant-velocity interpolation between samples.
    // Instead of lurching toward each new raw fix, we lerp from prevFix→curFix
    // at a steady pace, with slight dead-reckoning past curFix while waiting
    // for the next sample.  A small exponential polish on top handles micro-jitter.
    type Fix = { lng: number; lat: number; t: number };
    let prevFix: Fix | null = null;
    let curFix: Fix | null = t0 ? { lng: t0[0], lat: t0[1], t: performance.now() } : null;
    let lastSeenLng = t0?.[0] ?? NaN;
    let lastSeenLat = t0?.[1] ?? NaN;

    /* Apparent-speed estimate from consecutive fixes — robust fallback for the case where iOS
     * Core Location reports `speed = -1` (unknown). On a phone at rest, `pos.coords.speed` is
     * frequently null/-1, so we can't rely on the reported value alone to detect "stationary".
     * Tracks distance over the last ~6 s of fixes; treat below 0.7 m/s (~1.5 mph) as stationary. */
    type FixSample = { lng: number; lat: number; t: number };
    const fixSamples: FixSample[] = [];
    const FIX_WINDOW_MS = 6_000;
    let apparentSpeedMps: number | null = null;
    const recomputeApparentSpeed = (now: number) => {
      while (fixSamples.length > 1 && now - fixSamples[0]!.t > FIX_WINDOW_MS) fixSamples.shift();
      if (fixSamples.length < 2) {
        apparentSpeedMps = null;
        return;
      }
      let dist = 0;
      for (let i = 1; i < fixSamples.length; i += 1) {
        const a = fixSamples[i - 1]!;
        const b = fixSamples[i]!;
        dist += haversineMeters([a.lng, a.lat], [b.lng, b.lat]);
      }
      const span = (fixSamples[fixSamples.length - 1]!.t - fixSamples[0]!.t) / 1000;
      apparentSpeedMps = span > 0 ? dist / span : null;
    };

    /* Skip Mapbox marker / camera writes when the change is sub-meter — Mapbox repaints on every
     * setLngLat, and at 60 fps even noise far below 1 m can manifest as visible vibration. */
    const NOOP_LNGLAT_DELTA = 0.000005; /* ~0.55 m at the equator; smaller north of 45° */
    let lastBearingApplied = NaN;

    const loop = () => {
      if (puckMarkerRef.current !== marker) return;
      const t = userLngLatRef.current;
      if (t) {
        try {
        const now = performance.now();
        const dt = Math.min(0.12, (now - lastTs) / 1000);
        lastTs = now;

        // Detect a new GPS sample arriving.
        if (t[0] !== lastSeenLng || t[1] !== lastSeenLat) {
          prevFix = curFix;
          curFix = { lng: t[0], lat: t[1], t: now };
          lastSeenLng = t[0];
          lastSeenLat = t[1];
          fixSamples.push({ lng: t[0], lat: t[1], t: now });
          recomputeApparentSpeed(now);
        }

        // Compute interpolated position between the two most recent fixes.
        // Cap alpha at 1.0 so we don't overshoot curFix and then have to correct backward when
        // the next fix arrives — that's the per-second micro-backward "twitch" users perceive.
        let targetLng: number;
        let targetLat: number;
        if (prevFix && curFix && curFix.t > prevFix.t) {
          const interval = curFix.t - prevFix.t;
          const alpha = Math.min((now - prevFix.t) / interval, 1.0);
          targetLng = prevFix.lng + (curFix.lng - prevFix.lng) * alpha;
          targetLat = prevFix.lat + (curFix.lat - prevFix.lat) * alpha;
        } else {
          targetLng = curFix?.lng ?? t[0];
          targetLat = curFix?.lat ?? t[1];
        }

        // Snap to the route polyline when close enough (hysteresis reduces threshold flicker).
        const geom = puckSnapGeomRef.current;
        if (geom && geom.length >= 2) {
          const g0 = geom[0]!;
          const geomKey = `${geom.length}:${g0[0].toFixed(5)},${g0[1].toFixed(5)}`;
          if (geomKey !== lastGeomKey) {
            lastGeomKey = geomKey;
            snapLatched = false;
            snappedAlongSmooth = null;
            snapCumDist = buildCumulativeDistances(geom);
            snapRouteTotalM = snapCumDist[geom.length - 1] ?? 0;
          }
          // Windowed search: after the first snap we know roughly where we are,
          // so only scan a small window around the last position.  This is orders
          // of magnitude faster on long routes and also prevents the scan from
          // matching a parallel segment far ahead of the user.
          //
          // If we haven't snapped yet, seed the window from the guidance along-meters
          // passed in via snapSeedMetersRef rather than doing a full-route scan —
          // this avoids latching onto a closer-but-wrong parallel segment far ahead.
          const searchCenter = snappedAlongSmooth ?? snapSeedMetersRef.current;
          const snap = (snapCumDist && searchCenter != null)
            ? closestPointOnPolylineWindowed(
                [targetLng, targetLat], geom, snapCumDist,
                searchCenter, SNAP_BACK_M, SNAP_AHEAD_M,
              )
            : closestPointOnPolyline([targetLng, targetLat], geom);
          const latM = snap.lateralMetersApprox;
          const applyAlongSmooth = (along: number) => {
            const clamped = Math.max(0, Math.min(snapRouteTotalM, along));
            const pt = pointAtAlongMeters(geom, clamped);
            targetLng = pt[0]!;
            targetLat = pt[1]!;
          };
          if (snapLatched) {
            if (latM <= SNAP_OUT_M) {
              const rawAlong = snap.alongMeters;
              if (snappedAlongSmooth == null) snappedAlongSmooth = rawAlong;
              else {
                const alphaAlong = 1 - Math.exp(-dt / 0.32);
                snappedAlongSmooth += (rawAlong - snappedAlongSmooth) * alphaAlong;
              }
              applyAlongSmooth(snappedAlongSmooth);
            } else {
              snapLatched = false;
              snappedAlongSmooth = null;
            }
          } else if (latM < SNAP_IN_M) {
            snapLatched = true;
            snappedAlongSmooth = snap.alongMeters;
            applyAlongSmooth(snappedAlongSmooth);
          } else {
            snappedAlongSmooth = null;
          }
        } else {
          snapLatched = false;
          snappedAlongSmooth = null;
        }

        /* Tight exponential polish — the lerp above handles coarse motion. Stationary detection
         * keeps the puck steady when parked at a light or stopped in traffic: GPS still wobbles
         * 5–10 m even when the vehicle isn't moving, and at 1 Hz that wobble looks like a twitch
         * unless we lengthen the smoothing time constant dramatically.
         *
         * iOS Core Location frequently reports `speed = -1` (unknown) at low speeds, which arrives
         * here as `null`. We fall back to apparent speed measured directly from consecutive fixes
         * so stationary mode still triggers when the device-reported speed is missing. */
        const reportedSp = speedMpsRef.current;
        const effSp =
          reportedSp != null && reportedSp >= 0
            ? reportedSp
            : apparentSpeedMps != null
              ? apparentSpeedMps
              : null;
        const isStationary = effSp != null && effSp < 0.7;
        const isCrawling = effSp != null && effSp >= 0.7 && effSp < 2.0;
        /* TC = how long it takes the puck to converge to the target. Longer = more damping.
         *   stationary  → 2.4s   (heavy damping — pin the puck through GPS wobble while parked)
         *   crawling    → 0.32s  (light damping in stop-and-go traffic)
         *   snapped     → 0.145s (existing tuning)
         *   free / fast → 0.095s (existing tuning) */
        const blendTc = isStationary ? 2.4 : isCrawling ? 0.32 : snapLatched ? 0.145 : 0.095;
        const blend = 1 - Math.exp(-dt / blendTc);
        const cur = readMapLngLat(marker.getLngLat());
        if (!cur) {
          raf = requestAnimationFrame(loop);
          return;
        }
        const nextLng = cur[0] + (targetLng - cur[0]) * blend;
        const nextLat = cur[1] + (targetLat - cur[1]) * blend;
        /* Skip the write when the change is sub-half-meter — keeps Mapbox from repainting the
         * marker (and the follow camera) at 60 fps for sub-pixel deltas. This is the difference
         * between "occasionally settling toward a new fix" and "vibrating in place". */
        const moved =
          Math.abs(nextLng - cur[0]) > NOOP_LNGLAT_DELTA ||
          Math.abs(nextLat - cur[1]) > NOOP_LNGLAT_DELTA;
        if (moved && isValidLngLat(nextLng, nextLat)) {
          safeSetMapLngLat(marker, [nextLng, nextLat]);
        }

        /* Drive camera must track the smoothed puck — not raw GPS `easeTo` — or the map lurches while the puck glides. */
        const map = mapRef.current;
        if (
          map &&
          map.isStyleLoaded() &&
          viewModeRef.current === "drive" &&
          navigationStartedRef.current &&
          userLngLatRef.current &&
          !userExploringRef.current
        ) {
          const wx = typeof window !== "undefined" ? Math.round(window.innerWidth / 24) : 0;
          const wy = typeof window !== "undefined" ? Math.round(window.innerHeight / 24) : 0;
          const easeKey = `${stormBarVisibleRef.current}|${stormBarExpandedRef.current}|${progressRailVisibleRef.current}|${wx}x${wy}`;
          let easeCached = driveCamEaseOptsCacheRef.current;
          const easeLayoutChanged = !easeCached || easeCached.key !== easeKey;
          if (easeLayoutChanged) {
            const o = driveCameraEaseOptions(
              stormBarVisibleRef.current,
              stormBarExpandedRef.current,
              progressRailVisibleRef.current
            );
            easeCached = { key: easeKey, padding: o.padding, offset: o.offset };
            driveCamEaseOptsCacheRef.current = easeCached;
          }
          if (!easeCached) {
            raf = requestAnimationFrame(loop);
            return;
          }
          const { padding, offset } = easeCached;
          const rawBrg =
            driveRouteBearingDegRef.current != null
              ? driveRouteBearingDegRef.current
              : headingRef.current != null
                ? headingRef.current
                : map.getBearing();
          const alphaBrg = 1 - Math.exp(-dt / DRIVE_CAMERA_BEARING_TC_S);
          driveCamBearingSmoothedRef.current = smoothDriveBearingDeg(
            driveCamBearingSmoothedRef.current,
            rawBrg,
            alphaBrg
          );
          const pos = readMapLngLat(marker.getLngLat());
          /* Mirror the marker's no-op guard for the camera. Without this, easeTo runs every
           * frame even when target ≈ current, and Mapbox repaints — even sub-pixel deltas in
           * float math show up as a visible vibration. */
          const camCenter = readMapLngLat(map.getCenter());
          const bearingDelta = Number.isFinite(lastBearingApplied)
            ? Math.abs(driveCamBearingSmoothedRef.current - lastBearingApplied)
            : Infinity;
          const camMoved =
            !pos || !camCenter
              ? false
              : Math.abs(camCenter[0] - pos[0]) > NOOP_LNGLAT_DELTA ||
                Math.abs(camCenter[1] - pos[1]) > NOOP_LNGLAT_DELTA;
          const bearingMoved = bearingDelta > 0.05;
          /* When entering drive view the pitch/zoom may be totally wrong (e.g. flat topdown).
           * Force an easeTo if pitch or zoom are far from drive targets so the view snaps in
           * even when the puck hasn't moved relative to the camera center. */
          const pitchOff = Math.abs(map.getPitch() - 58) > 1;
          const forceCamSync = driveCamResyncRef.current;
          const applyLayoutOrEntry = pitchOff || forceCamSync || easeLayoutChanged;
          if (camMoved || bearingMoved || applyLayoutOrEntry) {
            if (
              pos &&
              safeEaseTo(map, {
                center: pos,
                ...(applyLayoutOrEntry
                  ? { zoom: driveNavZoomRef.current, pitch: 58 }
                  : {}),
                bearing: driveCamBearingSmoothedRef.current,
                padding,
                offset,
                duration: 0,
                essential: true,
              })
            ) {
              lastBearingApplied = driveCamBearingSmoothedRef.current;
              if (forceCamSync) driveCamResyncRef.current = false;
            }
          }
        }
        } catch (err) {
          console.warn("[drive-puck] RAF loop skipped frame", err);
        }
      }
      if (puckMarkerRef.current === marker) {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    /* Boolean(userLngLat): when nav starts before GPS / restore, first RAF run can bail (no marker).
     * After the puck effect creates the marker, we must re-arm RAF without listing coords (avoids GPS jitter resets). */
  }, [navigationStarted, mapReady, Boolean(userLngLat)]);

  /* Omit userLngLat from deps — GPS ticks would re-run Mapbox marker alignment every frame and jitter the puck. */
  useEffect(() => {
    const marker = puckMarkerRef.current;
    if (!marker) return;
    const el = marker.getElement();
    const isDriveView = navigationStarted && viewMode === "drive";
    el.classList.toggle("map-user-puck--driving", navigationStarted);
    try {
      marker.setOffset(isDriveView ? DRIVE_PUCK_MARKER_OFFSET_PX : [0, 0]);
      marker.setPitchAlignment(navigationStarted ? "viewport" : "map");
      marker.setRotationAlignment(navigationStarted ? "viewport" : "map");
    } catch {
      /* older mapbox */
    }
  }, [navigationStarted, viewMode, mapReady]);

  /** After route compare or end of navigation, re-run topdown init and flatten pitch. */
  useEffect(() => {
    if (trafficBypassCompareActive || offRouteRejoinCompareActive) {
      wasRouteCompareRef.current = true;
      return;
    }
    if (wasRouteCompareRef.current) {
      wasRouteCompareRef.current = false;
      prevTopdownRef.current = false;
    }
  }, [trafficBypassCompareActive, offRouteRejoinCompareActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const wasNav = prevNavigationStartedRef.current;
    prevNavigationStartedRef.current = navigationStarted;
    if (!wasNav || navigationStarted) return;
    prevTopdownRef.current = false;
    userExploringRef.current = false;
    if (exploreTimerRef.current) {
      clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = null;
    }
    stopMapCamera(map);
    flattenMapCamera(map);
    const u = userLngLatRef.current;
    const idleTopdown = viewModeRef.current === "topdown" || routes.length === 0;
    if (u && idleTopdown) {
      safeFlyTo(map, {
        center: u,
        zoom: topdownZoomRef.current,
        pitch: 0,
        bearing: 0,
        padding: ZERO_MAP_PADDING,
        offset: TOPDOWN_PUCK_OFFSET_PX,
        duration: 480,
        essential: true,
      });
    } else if (routes.length > 0 && viewModeRef.current === "route") {
      /* Route fit effect handles both ends once viewMode settles to Rt. */
      lastForcedPlanningFitTriggerRef.current = null;
    } else if (u) {
      safeFlyTo(map, {
        center: u,
        zoom: regionalPlanningZoom(),
        pitch: 0,
        bearing: 0,
        padding: ZERO_MAP_PADDING,
        duration: 480,
        essential: true,
      });
    }
  }, [navigationStarted, mapReady, routes.length, viewMode]);

  /** Leave 3D drive pitch/zoom whenever navigation is off or the user is not in Dr view. */
  useEffect(() => {
    if (activeDriveCamera) return;
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const pitched =
      map.getPitch() > 0.5 ||
      Math.abs(map.getBearing()) > 0.5 ||
      (routes.length === 0 && !navigationStarted && map.getZoom() > 15.5);
    if (!pitched) return;
    userExploringRef.current = false;
    stopMapCamera(map);
    flattenMapCamera(map);
    const u = userLngLatRef.current;
    if (!u) return;
    if (viewMode === "topdown" || routes.length === 0) {
      prevTopdownRef.current = false;
      safeFlyTo(map, {
        center: u,
        zoom: viewMode === "topdown" ? topdownZoomRef.current : regionalPlanningZoom(),
        pitch: 0,
        bearing: 0,
        padding: ZERO_MAP_PADDING,
        offset: viewMode === "topdown" ? TOPDOWN_PUCK_OFFSET_PX : [0, 0],
        duration: 420,
        essential: true,
      });
    }
  }, [
    activeDriveCamera,
    mapReady,
    viewMode,
    navigationStarted,
    routes.length,
    fitTrigger,
    recenterPlanningPuckTick,
    topdownZoomRef,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!destLngLat) {
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
      return;
    }

    if (!destMarkerRef.current) {
      destMarkerRef.current = new mapboxgl.Marker({ element: makeDestEl(), anchor: "center" })
        .setLngLat(destLngLat)
        .addTo(map);
    } else {
      destMarkerRef.current.setLngLat(destLngLat);
    }
  }, [mapReady, destLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const wanted = new Set(viaStops.map((_, i) => i));
    for (const [idx, marker] of viaMarkerMapRef.current) {
      if (!wanted.has(idx)) {
        marker.remove();
        viaMarkerMapRef.current.delete(idx);
      }
    }

    viaStops.forEach((stop, i) => {
      let marker = viaMarkerMapRef.current.get(i);
      if (!marker) {
        marker = new mapboxgl.Marker({ element: makeViaStopEl(), anchor: "center" })
          .setLngLat(stop.lngLat)
          .addTo(map);
        viaMarkerMapRef.current.set(i, marker);
      } else {
        marker.setLngLat(stop.lngLat);
      }
    });
  }, [mapReady, viaStops]);

  /**
   * Hazard pin during the bypass-compare flow — a pulsing red dot at the impact's lng/lat.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const lngLat = trafficBypassCompareHazardLngLat;
    if (!lngLat) {
      bypassHazardMarkerRef.current?.remove();
      bypassHazardMarkerRef.current = null;
      return;
    }

    if (!bypassHazardMarkerRef.current) {
      bypassHazardMarkerRef.current = new mapboxgl.Marker({
        element: makeBypassHazardEl(),
        anchor: "center",
      })
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      bypassHazardMarkerRef.current.setLngLat(lngLat);
    }

    return () => {
      bypassHazardMarkerRef.current?.remove();
      bypassHazardMarkerRef.current = null;
    };
  }, [mapReady, trafficBypassCompareHazardLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    let cancelled = false;
    let pendingStyleRetry = false;

    /** When there are no routes, always try to strip trip line layers; retry if style is mid-transition. */
    const clearTripRouteLayers = () => {
      if (cancelled || !map.isStyleLoaded()) return;
      routeIdsRef.current = applyRoutesToMap(
        map,
        [],
        lineFocusId,
        suggestedRouteId,
        routeIdsRef.current,
        "route",
        {
          orderedRouteIds,
          navigationStarted,
          viewMode,
          isOverviewPip: false,
          routeComparePicker: trafficBypassCompareActive,
          userAlongMeters: userAlongMetersRef.current,
        }
      );
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers([], lineFocusId, viewMode, false)
      );
    };

    const sync = (): boolean => {
      if (cancelled) return false;

      if (routes.length === 0) {
        clearTripRouteLayers();
        if (!map.isStyleLoaded()) {
          map.once("style.load", clearTripRouteLayers);
          map.once("idle", clearTripRouteLayers);
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) clearTripRouteLayers();
          });
        });
        return true;
      }

      if (!map.isStyleLoaded()) {
        if (!pendingStyleRetry) {
          pendingStyleRetry = true;
          const retry = () => {
            pendingStyleRetry = false;
            sync();
          };
          map.once("style.load", retry);
          map.once("idle", retry);
        }
        return false;
      }
      pendingStyleRetry = false;

      routeIdsRef.current = applyRoutesToMap(
        map,
        routes,
        lineFocusId,
        suggestedRouteId,
        routeIdsRef.current,
        "route",
        {
          orderedRouteIds,
          navigationStarted,
          viewMode,
          isOverviewPip: false,
          routeComparePicker: trafficBypassCompareActive,
          userAlongMeters: userAlongMetersRef.current,
        }
      );
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, viewMode, false)
      );
      return true;
    };

    syncTripRoutesRef.current = sync;

    lastDriveRouteLineSyncAlongRef.current = null;
    sync();
    map.on("style.load", sync);
    return () => {
      cancelled = true;
      syncTripRoutesRef.current = () => false;
      map.off("style.load", sync);
    };
  }, [
    mapReady,
    routes,
    lineFocusId,
    suggestedRouteId,
    orderedRouteIds,
    navigationStarted,
    viewMode,
    trafficBypassCompareActive,
  ]);

  /** Dr / Mp: refresh the ahead-only route slice as the puck moves (throttled — avoids map jank). */
  useEffect(() => {
    const nearNavLineView = viewMode === "drive" || viewMode === "topdown";
    if (!mapReady || !nearNavLineView || !navigationStarted || routes.length === 0) return;
    if (userExploringRef.current) return;
    const along = userAlongMeters;
    if (along == null || !Number.isFinite(along)) return;
    const prev = lastDriveRouteLineSyncAlongRef.current;
    if (prev != null && Math.abs(along - prev) < 450) return;
    lastDriveRouteLineSyncAlongRef.current = along;
    syncTripRoutesRef.current();
  }, [mapReady, viewMode, navigationStarted, routes.length, userAlongMeters]);

  /** One-shot route slice refresh when explore ends. */
  useEffect(() => {
    const nearNavLineView = viewMode === "drive" || viewMode === "topdown";
    if (!mapReady || !nearNavLineView || !navigationStarted || routes.length === 0) return;
    if (mapResumeTick === 0) return;
    lastDriveRouteLineSyncAlongRef.current = null;
    syncTripRoutesRef.current();
  }, [mapResumeTick, mapReady, viewMode, navigationStarted, routes.length]);

  /**
   * Map layer health: after routes load (especially on slow / low-data links), verify line layers
   * exist and re-sync if the style was not ready on the first pass. View cycling used to “fix” this.
   */
  useEffect(() => {
    if (!mapReady || routes.length === 0) return;
    const map = mapRef.current;
    if (!map) return;

    const verifyAndRepair = () => {
      if (!isMapUsable(map)) return;
      try {
        if (!map.isStyleLoaded()) return;
      } catch {
        return;
      }
      const { routes: rts, lineFocusId: lid, viewMode: vm } = routesForHitRef.current;
      if (rts.length === 0) return;
      const ids = visibleRouteIdsForHitLayers(rts, lid, vm, false);
      const missing = findMissingTripRouteLineLayers(map, ids);
      if (missing.length === 0) return;
      const now = Date.now();
      if (now - routeLayerHealthRepairAtRef.current < ROUTE_LAYER_HEALTH_REPAIR_COOLDOWN_MS) return;
      routeLayerHealthRepairAtRef.current = now;
      syncTripRoutesRef.current();
      reportAppHealthSignal("map_layers", "missing_route_lines", {
        count: missing.length,
        layers: missing.slice(0, 6).join("|"),
      });
      if (import.meta.env.DEV) {
        console.info("[map-health] re-synced missing route line layers", missing);
      }
    };

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const onIdle = () => {
      if (idleTimer != null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(verifyAndRepair, ROUTE_LAYER_HEALTH_IDLE_DEBOUNCE_MS);
    };

    const timers = ROUTE_LAYER_HEALTH_RETRY_MS.map((ms) => window.setTimeout(verifyAndRepair, ms));
    const poll = window.setInterval(verifyAndRepair, ROUTE_LAYER_HEALTH_POLL_MS);
    map.on("idle", onIdle);
    map.on("style.load", verifyAndRepair);

    const onVisible = () => {
      if (document.visibilityState === "visible") verifyAndRepair();
    };
    document.addEventListener("visibilitychange", onVisible);

    verifyAndRepair();

    return () => {
      for (const t of timers) window.clearTimeout(t);
      window.clearInterval(poll);
      if (idleTimer != null) window.clearTimeout(idleTimer);
      map.off("idle", onIdle);
      map.off("style.load", verifyAndRepair);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mapReady, routes, lineFocusId, viewMode, navigationStarted, mapResumeTick]);

  /** View cycle (Rt/Mp/Dr) used to remount layers; force route sync when mode changes. */
  useEffect(() => {
    if (!mapReady || routes.length === 0) return;
    syncTripRoutesRef.current();
  }, [viewMode, mapReady, routes.length]);

  useMapGeoJsonOverlays({
    mapRef,
    mapReady,
    recordingGeometry,
    userLngLat,
    activityTrailGeoJson,
    routes,
    lineFocusId,
    viewMode,
    navigationStarted,
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const hideNwsPolygons = navigationStarted && viewMode === "drive";
    const sync = () => {
      applyWeatherAlertLayers(map, hideNwsPolygons ? null : (weatherAlertGeoJson ?? null));
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, viewMode, false)
      );
    };
    if (map.isStyleLoaded()) sync();
    else map.once("load", sync);
  }, [mapReady, weatherAlertGeoJson, routes, lineFocusId, navigationStarted, viewMode]);

  /** Radar storm-motion arrows disabled — sampling was misleading; strip any legacy layers. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      removeRadarMotionLayers(map);
    } catch {
      /* style race */
    }
  }, [mapReady, showRadar]);

  useStormNwsHoverPopup({
    mapRef,
    mapReady,
    weatherAlertGeoJson,
    navigationStarted,
    viewMode,
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveFocusGeom = (): LngLat[] | undefined => {
      if (corridorRouteGeometry && corridorRouteGeometry.length >= 2) {
        return corridorRouteGeometry;
      }
      const leg = routes.find((r) => r.id === lineFocusId);
      return leg?.geometry && leg.geometry.length >= 2 ? leg.geometry : undefined;
    };

    const lift = () => {
      if (cancelled) return;
      const focusGeom = resolveFocusGeom();
      const hasRoute = Boolean(focusGeom?.length);

      if (!hasRoute) {
        clearRouteConditionHighlights(map);
        return;
      }

      if (userExploringRef.current) return;

      const clipBehindAlongM =
        navigationStarted && viewMode === "drive" ? userAlongMetersRef.current : null;

      const changed = applyRouteConditionHighlights(map, {
        alerts: alongRouteAlerts,
        routeGeometry: focusGeom,
        stormGeoJson: weatherAlertGeoJson,
        stormAlongRouteBands,
        clipBehindAlongM,
      });
      if (changed) {
        liftTrafficThenRoutesThenHits(
          map,
          visibleRouteIdsForHitLayers(routes, lineFocusId, viewMode, false)
        );
      }
    };

    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      const hasRoute = Boolean(resolveFocusGeom()?.length);
      if (!hasRoute) {
        lift();
        return;
      }
      if (userExploringRef.current) return;
      const debounceMs =
        navigationStarted && viewMode === "drive" ? 480 : 220;
      debounceTimer = setTimeout(lift, debounceMs);
    };

    if (map.isStyleLoaded()) schedule();
    else map.once("load", schedule);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [
    mapReady,
    alongRouteAlerts,
    corridorRouteGeometry,
    stormAlongRouteBands,
    routes,
    lineFocusId,
    navigationStarted,
    viewMode,
    weatherAlertGeoJson,
    highlightClipTick,
    mapResumeTick,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    let manifestTimer: ReturnType<typeof setInterval> | null = null;
    let radarLoopGeneration = 0;
    let lastRadarPathsKey = "";

    const clearTimers = () => {
      if (manifestTimer) {
        clearInterval(manifestTimer);
        manifestTimer = null;
      }
    };

    const liftRouteHits = () => {
      const { routes: rts, lineFocusId: lid, viewMode: vm } = routesForHitRef.current;
      const ids = visibleRouteIdsForHitLayers(rts, lid, vm, false);
      bringRouteVisualLinesAboveTraffic(map, ids, "route");
      bringRouteHitLayersToTop(map, ids, "route");
    };

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    type RadarCell = { path: string; time: number };

    /**
     * Load the next frame on the hidden side. With the long crossfade approach the bench side
     * loads during the ~2.8 s blend — plenty of time even on slow connections.
     */
    const prewarmFrame = (which: "a" | "b", url: string): Promise<void> => {
      setRainViewerRadarTilesOnSource(map, which, url);
      return waitForRainViewerSideLoaded(map, which, RAINVIEWER_RADAR_CROSSFADE_MS + 1000);
    };

    const runRadarFrameLoop = (loopGen: number, host: string, cells: RadarCell[]) => {
      const o = RAINVIEWER_RADAR_VISIBLE_OPACITY;
      void (async () => {
        let visible: "a" | "b" = "a";
        let idx = 0;

        /* Prime bench side after source A has had time to load — avoids the startup
         * burst where both sources request tiles simultaneously and hit RainViewer's
         * rate limit.  1.5 s is enough for A tiles to arrive before B starts. */
        if (radarAnimate && cells.length > 1 && !isRainViewerRateLimited()) {
          const nextUrl = tileUrlFromHostAndPath(host, cells[1]!.path);
          await sleep(3000);
          if (cancelled || loopGen !== radarLoopGeneration || mapRef.current !== map) return;
          setRainViewerRadarTilesOnSource(map, "b", nextUrl);
        }

        while (
          radarAnimate &&
          !cancelled &&
          loopGen === radarLoopGeneration &&
          cells.length > 1 &&
          !isRainViewerRateLimited() &&
          mapRef.current === map
        ) {
          if (userExploringRef.current) {
            await sleep(400);
            continue;
          }
          /* Show the current frame for its full dwell; bench is loading in parallel. */
          await sleep(RAINVIEWER_ANIMATION_DWELL_MS);
          if (cancelled || loopGen !== radarLoopGeneration || mapRef.current !== map) return;

          /* Cross-fade to the bench (whether tiles finished or not — partial is still smooth). */
          const incoming: "a" | "b" = visible === "a" ? "b" : "a";
          const from = visible === "a" ? { a: o, b: 0 } : { a: 0, b: o };
          const to = visible === "a" ? { a: 0, b: o } : { a: o, b: 0 };
          await animateRainViewerDualCrossfade(map, from, to, RAINVIEWER_RADAR_CROSSFADE_MS);
          if (cancelled || loopGen !== radarLoopGeneration || mapRef.current !== map) return;

          visible = incoming;
          idx = (idx + 1) % cells.length;
          onRadarFrameUtcSecRef.current?.(cells[idx]!.time);
          bringMapboxTrafficLayersToFront(map);
          liftRouteHits();

          /* While this frame is on screen, start warming the next one on the bench.
           * Small delay before pre-warm so successive tile batches don't overlap
           * and trigger RainViewer rate-limits. */
          const nextIdx = (idx + 1) % cells.length;
          const nextUrl = tileUrlFromHostAndPath(host, cells[nextIdx]!.path);
          await sleep(1200);
          if (cancelled || loopGen !== radarLoopGeneration || mapRef.current !== map) return;
          if (!isRainViewerRateLimited()) {
            void prewarmFrame(incoming === "a" ? "b" : "a", nextUrl);
          }
        }
      })();
    };

    const loadManifest = async () => {
      if (!showRadar) {
        clearTimers();
        radarLoopGeneration += 1;
        onRadarFrameUtcSecRef.current?.(null);
        removeRainViewerRadar(map);
        bringMapboxTrafficLayersToFront(map);
        liftRouteHits();
        return;
      }
      if (isRainViewerRateLimited()) return;
      const pack = await fetchRainViewerRadarFrames();
      if (cancelled || mapRef.current !== map) return;
      if (!pack?.frames.length) {
        radarLoopGeneration += 1;
        onRadarFrameUtcSecRef.current?.(null);
        removeRainViewerRadar(map);
        bringMapboxTrafficLayersToFront(map);
        liftRouteHits();
        return;
      }
      const host = pack.host;
      const cells: RadarCell[] = pack.frames.map((f) => ({ path: f.path, time: f.time }));
      const pathsKey = cells.map((c) => c.path).join("|");
      if (pathsKey === lastRadarPathsKey && map.getSource("rainviewer-radar-a")) {
        return;
      }
      lastRadarPathsKey = pathsKey;
      const url0 = tileUrlFromHostAndPath(host, cells[0]!.path);
      radarLoopGeneration += 1;
      const myGen = radarLoopGeneration;
      ensureRainViewerRadarDual(map, url0);
      positionRainViewerRadarUnderRoads(map);
      positionWeatherAlertLayersAboveRadar(map);
      bringMapboxTrafficLayersToFront(map);
      liftRouteHits();
      onRadarFrameUtcSecRef.current?.(cells[0]!.time);
      if (radarAnimate && cells.length > 1 && !isRainViewerRateLimited()) {
        runRadarFrameLoop(myGen, host, cells.slice(-2));
      }
    };

    void loadManifest();
    if (showRadar) manifestTimer = setInterval(() => void loadManifest(), 600_000);

    let rateLimitResumeTimer: number | null = null;
    const offRateLimit = onRainViewerRateLimit(() => {
      if (!showRadar || mapRef.current !== map) return;
      setRainViewerRadarLayersVisible(map, false);
      if (rateLimitResumeTimer) window.clearTimeout(rateLimitResumeTimer);
      rateLimitResumeTimer = window.setTimeout(() => {
        rateLimitResumeTimer = null;
        if (cancelled || mapRef.current !== map || !showRadar) return;
        if (!isRainViewerRateLimited()) {
          setRainViewerRadarLayersVisible(map, true);
          void loadManifest();
        }
      }, rainViewerRateLimitMsRemaining() + 500);
    });

    return () => {
      cancelled = true;
      offRateLimit();
      if (rateLimitResumeTimer) clearTimeout(rateLimitResumeTimer);
      radarLoopGeneration += 1;
      onRadarFrameUtcSecRef.current?.(null);
      clearTimers();
      try {
        if (mapRef.current === map) removeRainViewerRadar(map);
      } catch {
        /* map may already be torn down */
      }
    };
  }, [mapReady, showRadar, radarAnimate]);

  /** Idle home (no trip): frame on My location or trail area; retry until GPS + style are ready. */
  const idleHomeAppliedRef = useRef(false);
  const hadTrailBoundsRef = useRef(false);
  useEffect(() => {
    if (routes.length > 0 || navigationStarted || viewMode === "drive") {
      idleHomeAppliedRef.current = false;
    }
  }, [viewMode, routes.length, navigationStarted]);

  useEffect(() => {
    idleHomeAppliedRef.current = false;
  }, [idleHomeMapFraming]);

  useEffect(() => {
    if (homePuckFollow !== "follow" || routes.length > 0 || navigationStarted) return;
    userExploringRef.current = false;
    idleHomeAppliedRef.current = false;
    if (exploreTimerRef.current) {
      clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = null;
    }
    setMapResumeTick((n) => n + 1);
  }, [homePuckFollow, routes.length, navigationStarted]);

  useEffect(() => {
    const hasBounds = activityTrailPlanningBounds != null;
    if (hasBounds && !hadTrailBoundsRef.current && idleHomeMapFraming === "auto") {
      idleHomeAppliedRef.current = false;
    }
    hadTrailBoundsRef.current = hasBounds;
  }, [activityTrailPlanningBounds, idleHomeMapFraming]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (viewMode !== "route" && viewMode !== "topdown") return;
    if (routes.length > 0 || navigationStarted) return;

    const tryApplyIdleHome = (): boolean => {
      if (idleHomeAppliedRef.current) return true;
      if (userExploringRef.current) return false;
      const u = userLngLatRef.current;
      if (!u) return false;
      if (!isMapUsable(map)) return false;
      try {
        if (!map.isStyleLoaded()) return false;
      } catch {
        return false;
      }

      const framing = resolveIdleHomeFraming(idleHomeMapFraming, activityTrailPlanningBounds);
      if (homePuckFollowRef.current === "explore" && framing !== "activity_area") {
        idleHomeAppliedRef.current = true;
        return true;
      }
      let ok = false;
      if (framing === "activity_area" && activityTrailPlanningBounds) {
        const tb = activityTrailPlanningBounds;
        const b = new mapboxgl.LngLatBounds();
        safeExtendBounds(b, u);
        safeExtendBounds(b, tb[0]);
        safeExtendBounds(b, tb[1]);
        ok = safeFitBounds(map, b, {
          padding: 48,
          maxZoom: 11.2,
          duration: 520,
          pitch: 0,
          bearing: 0,
          essential: true,
        });
      } else if (viewMode === "topdown") {
        topdownZoomRef.current = ROUTE_VIEW_PLANNING_STREET_ZOOM;
        ok = safeFlyTo(map, {
          center: u,
          zoom: ROUTE_VIEW_PLANNING_STREET_ZOOM,
          pitch: 0,
          bearing: 0,
          padding: ZERO_MAP_PADDING,
          offset: TOPDOWN_PUCK_OFFSET_PX,
          duration: 520,
          essential: true,
        });
      } else {
        ok = safeEaseTo(map, {
          center: u,
          zoom: ROUTE_VIEW_PLANNING_STREET_ZOOM,
          pitch: 0,
          bearing: 0,
          padding: ZERO_MAP_PADDING,
          duration: 520,
          essential: true,
        });
      }
      if (ok) idleHomeAppliedRef.current = true;
      return ok;
    };

    if (tryApplyIdleHome()) return;

    const onReady = () => {
      tryApplyIdleHome();
    };
    map.on("load", onReady);
    map.on("style.load", onReady);
    const timers = [250, 800, 2000, 4500].map((ms) => window.setTimeout(onReady, ms));

    return () => {
      map.off("load", onReady);
      map.off("style.load", onReady);
      for (const id of timers) window.clearTimeout(id);
    };
  }, [
    mapReady,
    viewMode,
    routes.length,
    navigationStarted,
    Boolean(userLngLat),
    activityTrailPlanningBounds,
    idleHomeMapFraming,
    homePuckFollow,
  ]);

  const homePreloadBoundsKey = homePreloadBounds
    ? `${homePreloadBounds[0].join(",")}|${homePreloadBounds[1].join(",")}`
    : "";

  useEffect(() => {
    if (!homePreloadEnabled || !homePreloadBounds || !mapReady) return;
    if (navigationStarted || routes.length > 0) return;
    if (viewMode !== "route" && viewMode !== "topdown") return;
    if (shouldSkipHomePreloadThrottle(homePreloadBounds)) return;

    let cancelled = false;
    let startTimer = 0;

    const run = async () => {
      if (cancelled) return;
      if (!(await isWifiConnection())) return;
      if (userExploringRef.current || navigationStartedRef.current) return;

      const map = mapRef.current;
      if (!map || !isMapUsable(map)) return;
      try {
        if (!map.isStyleLoaded()) return;
      } catch {
        return;
      }

      const result = await warmMapTilesForBounds(map, homePreloadBounds, () =>
        cancelled || userExploringRef.current || navigationStartedRef.current
      );
      if (result === "done" && !cancelled) {
        markHomePreloadCompleted(homePreloadBounds);
      }
    };

    startTimer = window.setTimeout(() => {
      void run();
    }, HOME_PRELOAD_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [
    mapReady,
    homePreloadEnabled,
    homePreloadBoundsKey,
    navigationStarted,
    routes.length,
    viewMode,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || viewMode !== "route" && viewMode !== "topdown") return;
    if (routes.length > 0 || navigationStarted) return;
    if (userExploringRef.current) return;
    const u = userLngLatRef.current;
    if (!u || !destLngLat) return;
    if (viewMode === "topdown") {
      prevTopdownRef.current = false;
      safeFlyTo(map, {
        center: u,
        zoom: resolveTopdownLocalZoom(topdownZoomRef, false),
        pitch: 0,
        bearing: 0,
        padding: ZERO_MAP_PADDING,
        offset: TOPDOWN_PUCK_OFFSET_PX,
        duration: 480,
        essential: true,
      });
      return;
    }
    fitMapToTrip(
      map,
      [],
      u,
      destLngLat,
      routeFitPadding(stormBarVisible, stormBarExpanded, [], null, progressRailVisible),
      ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM,
      {}
    );
  }, [
    mapReady,
    viewMode,
    routes.length,
    navigationStarted,
    destLngLat,
    fitTrigger,
    stormBarVisible,
    stormBarExpanded,
    progressRailVisible,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || routes.length > 0) return;
    if (viewMode !== "route" && viewMode !== "topdown") return;
    if (recenterPlanningPuckTick === 0) return;
    const u = userLngLatRef.current;
    if (!u) return;
    userExploringRef.current = false;
    if (exploreTimerRef.current) {
      clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = null;
    }
    const zoom = Math.max(ROUTE_VIEW_PLANNING_STREET_ZOOM, map.getZoom());
    if (viewMode === "topdown") {
      topdownZoomRef.current = zoom;
      prevTopdownRef.current = false;
      safeFlyTo(map, {
        center: u,
        zoom,
        pitch: 0,
        bearing: 0,
        padding: ZERO_MAP_PADDING,
        offset: TOPDOWN_PUCK_OFFSET_PX,
        duration: 480,
        essential: true,
      });
    } else {
      safeEaseTo(map, {
        center: u,
        zoom,
        pitch: 0,
        bearing: 0,
        padding: ZERO_MAP_PADDING,
        duration: 480,
        essential: true,
      });
    }
    /* Intentionally omit userLngLat from deps — GPS updates must not re-fire this (only tick bumps). */
  }, [mapReady, viewMode, routes.length, recenterPlanningPuckTick, topdownZoomRef]);

  useEffect(() => {
    if (viewMode !== "drive" || !navigationStarted) {
      driveCamBearingSmoothedRef.current = null;
    }
  }, [viewMode, navigationStarted]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (viewMode !== "route" && viewMode !== "topdown") return;
    if (routes.length === 0) return;

    let enteredRouteView = false;
    if (prevPlanningViewModeRef.current !== viewMode) {
      prevPlanningViewModeRef.current = viewMode;
      userExploringRef.current = false;
      if (exploreTimerRef.current) {
        clearTimeout(exploreTimerRef.current);
        exploreTimerRef.current = null;
      }
      if (viewMode === "route") {
        enteredRouteView = true;
        navRouteSnapKeyRef.current = "";
        topdownSnapKeyRef.current = "";
        prevTopdownRef.current = false;
        lastForcedPlanningFitTriggerRef.current = null;
      }
    }

    let cancelled = false;

    const clearPlanningFitTimers = () => {
      if (planningFitRafRef.current != null) {
        cancelAnimationFrame(planningFitRafRef.current);
        planningFitRafRef.current = null;
      }
      if (planningFitRetryTimerRef.current != null) {
        window.clearTimeout(planningFitRetryTimerRef.current);
        planningFitRetryTimerRef.current = null;
      }
      if (planningFitVerifyTimerRef.current != null) {
        window.clearTimeout(planningFitVerifyTimerRef.current);
        planningFitVerifyTimerRef.current = null;
      }
    };

    const prevCount = prevPlanningRouteCountRef.current;
    prevPlanningRouteCountRef.current = routes.length;
    const routesJustLoaded = prevCount === 0 && routes.length > 0;

    const forcePlanningFit = !navigationStarted || viewMode === "route";
    /* Any App-driven refit (reroute, slot change, etc.) must win over stale "user exploring" from pan/zoom. */
    if (fitTrigger !== lastForcedPlanningFitTriggerRef.current || routesJustLoaded) {
      lastForcedPlanningFitTriggerRef.current = fitTrigger;
      userExploringRef.current = false;
      if (exploreTimerRef.current) {
        clearTimeout(exploreTimerRef.current);
        exploreTimerRef.current = null;
      }
    }

    const flatten = () => {
      safeEaseTo(map, { pitch: 0, bearing: 0, duration: 240, essential: true });
    };

    let pendingFlatten: (() => void) | null = null;

    const executePlanningFit = (): boolean => {
      if (userExploringRef.current && !forcePlanningFit) return false;
      if (!mapStyleReadyForCamera(map)) return false;
      const u = userLngLatRef.current;
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
      return fitMapToTrip(
        map,
        routes,
        u,
        destLngLat,
        {
          ...routeFitPadding(stormBarVisible, stormBarExpanded, routes, lineFocusId, progressRailVisible),
        },
        routeFitMaxZoomCeiling(routes, lineFocusId),
        {
          onAfterFit: () => {
            flatten();
          },
          onlyRouteId: lineFocusId,
          zoomBias: routeFitZoomBias(routes, lineFocusId),
          forceFullPolyline: true,
        }
      );
    };

    const verifyPlanningZoom = (attempt: number) => {
      if (cancelled || navigationStartedRef.current || routes.length === 0) return;
      if (viewModeRef.current !== "route" && viewModeRef.current !== "topdown") return;
      if (isUltraLongTripRoute(sessionRouteLengthMRef.current)) return;
      let zoom = 0;
      try {
        zoom = map.getZoom();
      } catch {
        return;
      }
      const minPlanningZoom = minPlanningRouteZoomFloor(sessionRouteLengthMRef.current);
      if (zoom >= minPlanningZoom) return;
      if (attempt >= 5) return;
      if (!executePlanningFit()) {
        planningFitRetryTimerRef.current = window.setTimeout(
          () => verifyPlanningZoom(attempt + 1),
          220 + attempt * 180
        );
        return;
      }
      planningFitVerifyTimerRef.current = window.setTimeout(
        () => verifyPlanningZoom(attempt + 1),
        480 + attempt * 120
      );
    };

    const retryWhenReady = () => {
      if (cancelled) return;
      if (!executePlanningFit()) verifyPlanningZoom(1);
      else {
        planningFitVerifyTimerRef.current = window.setTimeout(() => verifyPlanningZoom(0), 520);
      }
    };

    const schedulePlanningRouteFit = () => {
      if (executePlanningFit()) {
        if (!navigationStartedRef.current) {
          planningFitVerifyTimerRef.current = window.setTimeout(() => verifyPlanningZoom(0), 520);
        }
        return;
      }
      clearPlanningFitTimers();
      planningFitRafRef.current = requestAnimationFrame(() => {
        planningFitRafRef.current = null;
        if (cancelled) return;
        if (!executePlanningFit()) {
          map.once("idle", retryWhenReady);
          map.once("style.load", retryWhenReady);
          planningFitRetryTimerRef.current = window.setTimeout(retryWhenReady, 160);
        } else if (!navigationStartedRef.current) {
          planningFitVerifyTimerRef.current = window.setTimeout(() => verifyPlanningZoom(0), 520);
        }
      });
    };

    /** Rt: full trip overview (not Mp-style remaining-leg or puck framing). */
    const forceRouteOverviewFit = () => {
      topdownSnapKeyRef.current = "";
      prevTopdownRef.current = false;
      userExploringRef.current = false;
      schedulePlanningRouteFit();
    };

    /** Map (Mp): top-down on the user’s position — route lines stay visible; camera does not fit the whole trip. */
    const doTopdownLocalFit = () => {
      if (userExploringRef.current) return;
      if (!mapStyleReadyForCamera(map)) return;
      const u = userLngLatRef.current;
      if (!u) return;
      const zoom = navigationStarted
        ? coerceTopdownNavStreetZoom(map, topdownZoomRef)
        : resolveTopdownLocalZoom(topdownZoomRef, false);
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
      pendingFlatten = () => {
        pendingFlatten = null;
        flatten();
      };
      map.once("moveend", pendingFlatten);
      prevTopdownRef.current = false;
      safeFlyTo(map, {
        center: u,
        zoom,
        pitch: 0,
        bearing: 0,
        padding: ZERO_MAP_PADDING,
        offset: TOPDOWN_PUCK_OFFSET_PX,
        duration: navigationStarted ? 340 : 480,
        essential: true,
      });
    };

    const compareLockedRouteId =
      rejoinCompareLockedRouteId?.trim() ||
      routes.find((r) => r.id === "r-a")?.id ||
      routes[0]?.id ||
      lineFocusId;

    /** Off-route Mp: fit user + B/C rejoin legs (+ local slice of locked A). */
    const doOffRouteRejoinFit = () => {
      if (userExploringRef.current) return;
      if (!mapStyleReadyForCamera(map)) return;
      const u = userLngLatRef.current;
      if (!u) return;
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
      pendingFlatten = () => {
        pendingFlatten = null;
        flatten();
      };
      map.once("moveend", pendingFlatten);
      prevTopdownRef.current = true;
      fitMapToOffRouteRejoinChoices(
        map,
        routes,
        u,
        compareLockedRouteId,
        routeFitPadding(stormBarVisible, stormBarExpanded, routes, lineFocusId, progressRailVisible),
        Math.min(routeFitMaxZoomCeiling(routes, lineFocusId), 17.6)
      );
    };

    /** Hazard / bypass compare: local corridor around user + jam, not the full trip. */
    const doRouteCompareLocalFit = () => {
      if (userExploringRef.current) return;
      if (!mapStyleReadyForCamera(map)) return;
      const u = userLngLatRef.current;
      if (!u) return;
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
      pendingFlatten = () => {
        pendingFlatten = null;
        flatten();
      };
      map.once("moveend", pendingFlatten);
      prevTopdownRef.current = true;
      fitMapToRouteCompareLocal(
        map,
        routes,
        u,
        compareLockedRouteId,
        trafficBypassCompareHazardLngLat,
        routeFitPadding(stormBarVisible, stormBarExpanded, routes, lineFocusId, progressRailVisible),
        Math.min(routeFitMaxZoomCeiling(routes, lineFocusId), 17.8),
        {
          userAlongM: userAlongMetersRef.current ?? 0,
          hazardAlongM: trafficBypassCompareHazardAlongMeters,
        }
      );
    };

    const offRouteCompare = navigationStarted && offRouteRejoinCompareActive;
    const routeCompareActive = trafficBypassCompareActive;

    if (viewMode === "topdown") {
      /* Nav: local street snap once per view/resume — GPS follow is a separate pan effect. */
      const snapKey = routeCompareActive
        ? `${viewMode}|${fitTrigger}|${mapResumeTick}|compare|${compareLockedRouteId}|${lineFocusId}|${trafficBypassCompareHazardLngLat?.[0] ?? ""}|${offRouteAlternatesFitKey(routes, compareLockedRouteId)}`
        : offRouteCompare
          ? `${viewMode}|${fitTrigger}|${mapResumeTick}|offroute|${offRouteAlternatesFitKey(routes, compareLockedRouteId)}`
          : navigationStarted
            ? `${viewMode}|${fitTrigger}|${mapResumeTick}|nav`
            : `${viewMode}|${fitTrigger}|${mapResumeTick}|plan|${routesPlanningFitKey}`;
      if (topdownSnapKeyRef.current !== snapKey) {
        topdownSnapKeyRef.current = snapKey;
        if (routeCompareActive) doRouteCompareLocalFit();
        else if (offRouteCompare) doOffRouteRejoinFit();
        else doTopdownLocalFit();
      }
    } else if (viewMode === "route") {
      const routeOverviewSnapKey = `${viewMode}|${fitTrigger}|${mapResumeTick}|${lineFocusId}|${routesPlanningFitKey}`;
      if (enteredRouteView || navRouteSnapKeyRef.current !== routeOverviewSnapKey) {
        navRouteSnapKeyRef.current = routeOverviewSnapKey;
        forceRouteOverviewFit();
      }
    } else {
      topdownSnapKeyRef.current = "";
    }

    return () => {
      cancelled = true;
      clearPlanningFitTimers();
      map.off("idle", retryWhenReady);
      map.off("style.load", retryWhenReady);
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
    };
  }, [
    mapReady,
    fitTrigger,
    viewMode,
    routesPlanningFitKey,
    destLngLat,
    navigationStarted,
    mapResumeTick,
    stormBarVisible,
    stormBarExpanded,
    lineFocusId,
    progressRailVisible,
    chromeLayoutTick,
    offRouteRejoinCompareActive,
    trafficBypassCompareActive,
    trafficBypassCompareHazardLngLat,
    trafficBypassCompareHazardAlongMeters,
    rejoinCompareLockedRouteId,
    /* Intentionally omit userAlongMeters — GPS ticks fire every second and would cancel the
     * pending 160 ms retry timer on every tick, preventing the camera from ever settling on
     * the route overview.  The compare-mode fits read userAlongMetersRef.current directly. */
  ]);

  /**
   * Rt / T / Dr: programmatic camera must not stay blocked by `userExploringRef` (set on pan/zoom).
   * Without this, users see a zoomed-out or wrong framing until another gesture clears explore mode.
   */
  useEffect(() => {
    if (!mapReady) return;
    if (viewMode === "topdown" && navigationStarted) {
      if (topdownZoomRef.current < TOPDOWN_NAV_MIN_ZOOM) {
        topdownZoomRef.current = TOPDOWN_NAV_STREET_ZOOM;
      }
      prevTopdownRef.current = false;
    }
    userExploringRef.current = false;
    if (exploreTimerRef.current) {
      clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = null;
    }
    if (viewMode === "drive" && navigationStarted) {
      driveCamResyncRef.current = true;
    }
    const map = mapRef.current;
    const raf0 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          map?.resize();
        } catch {
          /* map disposed */
        }
        setMapResumeTick((n) => n + 1);
      });
    });
    return () => cancelAnimationFrame(raf0);
  }, [mapReady, viewMode, navigationStarted, topdownZoomRef]);

  const canCameraFollow = Boolean(
    userLngLat &&
      (navigationStarted ||
        routes.length > 0 ||
        (idleHomeScreen && homePuckFollow === "follow") ||
        (viewMode === "topdown" && !(idleHomeScreen && homePuckFollow === "explore")))
  );

  /** On Go: clear "user exploring" so the drive camera is not stuck; nudge follow + size after nav chrome. */
  const wasNavRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady) return;
    if (navigationStarted && !wasNavRef.current) {
      userExploringRef.current = false;
      driveNavZoomRef.current = 16.35;
      driveCamResyncRef.current = true;
      if (exploreTimerRef.current) {
        clearTimeout(exploreTimerRef.current);
        exploreTimerRef.current = null;
      }
      setMapResumeTick((n) => n + 1);
      if (map) {
        requestAnimationFrame(() => {
          try {
            map.resize();
          } catch {
            /* map disposed */
          }
        });
      }
    }
    wasNavRef.current = navigationStarted;
  }, [mapReady, navigationStarted]);

  /**
   * Rt / T / Dr: switching back to drive after top-down (or a layout shift) can leave the canvas
   * sized to a stale box — the puck and follow camera sit wrong until a resize. Double-rAF + bump
   * so {@link canCameraFollow} run re-runs after the real layout.
   */
  useEffect(() => {
    if (viewMode !== "drive" || !navigationStarted || !mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    driveCamResyncRef.current = true;
    const raf0 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          map.resize();
        } catch {
          /* map disposed */
        }
        setMapResumeTick((n) => n + 1);
      });
    });
    return () => cancelAnimationFrame(raf0);
  }, [viewMode, navigationStarted, mapReady]);

  /** Foreground / style reload can leave drive follow-cam desynced while the puck keeps updating. */
  useEffect(() => {
    if (!mapReady || !navigationStarted || viewMode !== "drive") return;
    const map = mapRef.current;
    if (!map) return;

    const nudgeFollowCam = () => {
      userExploringRef.current = false;
      driveCamResyncRef.current = true;
      setMapResumeTick((n) => n + 1);
      try {
        map.resize();
      } catch {
        /* map disposed */
      }
    };

    const onStyle = () => nudgeFollowCam();
    map.on("style.load", onStyle);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      nudgeFollowCam();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      map.off("style.load", onStyle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mapReady, navigationStarted, viewMode]);

  /** Report map bearing while driving so the dock compass can keep N aligned with true north. */
  useEffect(() => {
    const map = mapRef.current;
    const report = onDriveCameraBearingDegRef.current;
    if (!map || !mapReady || !report) return;
    if (viewMode !== "drive" || !navigationStarted) {
      report(null);
      return;
    }
    let rafId = 0;
    let lastSent: number | null = null;
    let lastSentAt = 0;
    const minIntervalMs = 110;
    const minDeltaDeg = 0.4;
    const smallestBearingDelta = (a: number, b: number) => {
      let d = Math.abs(a - b) % 360;
      if (d > 180) d = 360 - d;
      return d;
    };
    const push = () => {
      rafId = 0;
      const deg = map.getBearing();
      const now = performance.now();
      if (
        lastSent != null &&
        smallestBearingDelta(deg, lastSent) < minDeltaDeg &&
        now - lastSentAt < minIntervalMs
      ) {
        return;
      }
      lastSent = deg;
      lastSentAt = now;
      report(deg);
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(push);
    };
    push();
    map.on("move", schedule);
    map.on("rotate", schedule);
    return () => {
      map.off("move", schedule);
      map.off("rotate", schedule);
      if (rafId) cancelAnimationFrame(rafId);
      report(null);
    };
  }, [mapReady, viewMode, navigationStarted]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const idleHomeFollow = idleHomeScreen && homePuckFollow === "follow";
    const followTopdownView = viewMode === "topdown";
    const followRouteHome = viewMode === "route" && idleHomeFollow;

    if (!canCameraFollow || (!followTopdownView && !followRouteHome)) {
      if (!followTopdownView) prevTopdownRef.current = false;
      return;
    }

    if ((trafficBypassCompareActive || offRouteRejoinCompareActive) && followTopdownView) {
      prevTopdownRef.current = true;
      return () => {
        if (!userExploringRef.current) stopMapCamera(map);
      };
    }

    const followPuck = () => {
      if (userExploringRef.current) return;
      const u = userLngLatRef.current;
      if (!u) return;

      if (followRouteHome) {
        safePanToCenter(map, {
          center: u,
          pitch: 0,
          bearing: 0,
        });
        return;
      }

      const nav = navigationStartedRef.current;
      const zoom = nav
        ? coerceTopdownNavStreetZoom(map, topdownZoomRef)
        : resolveTopdownLocalZoom(topdownZoomRef, false);
      if (!prevTopdownRef.current) {
        prevTopdownRef.current = true;
        safePanToCenter(map, {
          center: u,
          zoom,
          pitch: 0,
          bearing: 0,
          offset: TOPDOWN_PUCK_OFFSET_PX,
        });
      } else {
        let mapZoom = zoom;
        try {
          mapZoom = map.getZoom();
        } catch {
          /* map torn down */
        }
        safePanToCenter(map, {
          center: u,
          ...(nav &&
          !userExploringRef.current &&
          mapZoom < TOPDOWN_NAV_MIN_ZOOM - 0.08
            ? { zoom }
            : {}),
          offset: TOPDOWN_PUCK_OFFSET_PX,
        });
      }
    };

    followPuck();
  }, [
    mapReady,
    viewMode,
    canCameraFollow,
    topdownZoomRef,
    mapResumeTick,
    trafficBypassCompareHazardLngLat,
    trafficBypassCompareActive,
    offRouteRejoinCompareActive,
    destLngLat,
    routes,
    navigationStarted,
    topdownFollowKey,
    idleHomeFollowKey,
    homePuckFollow,
    routes.length,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const saveZoom = () => {
      if (viewMode === "topdown" && canCameraFollow) {
        topdownZoomRef.current = map.getZoom();
      }
    };
    map.on("zoomend", saveZoom);
    return () => {
      map.off("zoomend", saveZoom);
    };
  }, [mapReady, viewMode, canCameraFollow, topdownZoomRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const existing = savedMarkerMapRef.current;

    if (!savedPlacesVisible || savedPlaces.length === 0) {
      for (const { marker } of existing.values()) marker.remove();
      existing.clear();
      return;
    }

    const wantedIds = new Set(savedPlaces.map((p) => p.id));

    for (const [id, { marker }] of existing) {
      if (!wantedIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    for (const p of savedPlaces) {
      if (existing.has(p.id)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "saved-place-dot";
      el.title = p.name;
      el.setAttribute("aria-label", `Saved: ${p.name}`);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        onSavedClickRef.current(p.id);
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat(p.lngLat)
        .addTo(map);
      existing.set(p.id, { marker, el });
    }

    const applyScale = () => {
      const { sizePx, borderPx } = savedPlaceDotSizeForZoom(map.getZoom());
      for (const { el } of existing.values()) {
        el.style.setProperty("--saved-place-dot-size", `${sizePx.toFixed(2)}px`);
        el.style.setProperty("--saved-place-dot-border", `${borderPx.toFixed(2)}px`);
      }
    };

    applyScale();
    map.on("zoom", applyScale);
    return () => {
      map.off("zoom", applyScale);
    };
  }, [mapReady, savedPlaces, savedPlacesVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const existing = searchPickMarkerMapRef.current;
    const markers = searchPickMarkers;
    const canClick = Boolean(onSearchPickMarkerClick);

    if (!markers?.length || !canClick) {
      for (const { marker } of existing.values()) marker.remove();
      existing.clear();
      return;
    }

    const wantedIds = new Set(markers.map((m) => m.id));
    for (const [id, { marker }] of existing) {
      if (!wantedIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    for (const m of markers) {
      if (existing.has(m.id)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-search-pick-dot";
      el.title = m.label;
      el.setAttribute("aria-label", `Search result: ${m.label}`);
      const mid = m.id;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        onSearchPickMarkerClickRef.current?.(mid);
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat(m.lngLat)
        .addTo(map);
      existing.set(m.id, { marker, el });
    }

    const applyScale = () => {
      const z = map.getZoom();
      const s = Math.max(0.15, Math.min(1, (z - 2.5) / 12.5));
      for (const { el } of existing.values()) {
        el.style.transform = `scale(${s})`;
      }
    };

    applyScale();
    map.on("zoom", applyScale);
    return () => {
      map.off("zoom", applyScale);
    };
  }, [mapReady, searchPickMarkers, onSearchPickMarkerClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers = searchPickMarkers;
    if (!markers || markers.length < 2) return;

    const b = new mapboxgl.LngLatBounds();
    for (const m of markers) safeExtendBounds(b, m.lngLat as [number, number]);
    const u = userLngLatRef.current;
    if (u) safeExtendBounds(b, u);

    const pad = isNarrowPhoneViewport()
      ? { top: 200, bottom: 200, left: 20, right: 88 }
      : { top: 160, bottom: 160, left: 28, right: 28 };
    safeFitBounds(map, b, { padding: pad, maxZoom: 14, duration: 480, essential: true });
    /* Intentionally not depending on userLngLat — GPS ticks would re-fit; ref has latest puck. */
  }, [mapReady, searchPickMarkers]);

  if (!token) {
    return (
      <div className="drive-map map-missing-token">
        <p>
          Add <code>VITE_MAPBOX_TOKEN</code> to <code>web/.env</code>.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="drive-map" />;
}

export const DriveMap = memo(DriveMapInner, driveMapPropsAreEqual);

export default DriveMap;
