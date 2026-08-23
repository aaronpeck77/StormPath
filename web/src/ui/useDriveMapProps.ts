import { useCallback, type MutableRefObject } from "react";
import type { HomeMapFraming } from "../map/homeMapFraming";
import type { HomePuckFollowMode } from "../map/homePuckFollow";
import type { RouteAlert } from "../nav/routeAlerts";
import type { TripStop } from "../nav/routeWaypoints";
import type { LngLat, NavRoute } from "../nav/types";
import type { SavedPlace } from "../nav/savedPlaces";
import type { RadarDisplayMode } from "../state/settingsStore";
import type { TrafficBypassCompareState } from "../state/routeCompareStore";
import type { StormProgressStripBand } from "../weatherAlerts/geometryOverlap";
import type { DriveMapProps, MapFocusRequest, MapViewMode } from "./DriveMap";
import type { RadarFrameHudMeta } from "../services/radarMapPack";

/**
 * DriveMap prop assembly — Phase 3a.
 *
 * Owns the ~90-prop bag that used to live inline in `App.tsx` JSX. Behavior is
 * unchanged: same values, same derived flags (radar animate, puck snap, traffic
 * overlay). App keeps owning the *sources*; this module only assembles the map
 * surface contract so App's render tree stays readable.
 *
 * Prefer {@link buildDriveMapProps} in tests; {@link useDriveMapProps} wires the
 * home-pan callback for React callers.
 */
export type UseDriveMapPropsInput = {
  routes: NavRoute[];
  lineFocusId: string;
  suggestedRouteId: string | null;
  userLngLat: [number, number] | null;
  navigationStarted: boolean;
  liveLngLatRef: MutableRefObject<LngLat | null>;
  liveSpeedMpsRef: MutableRefObject<number | null>;
  liveHeadingRef: MutableRefObject<number | null>;
  destLngLat: [number, number] | null;
  viaStops: TripStop[];
  fitTrigger: number;
  viewMode: MapViewMode;
  heading: number | null;
  driveRouteBearingDeg: number | null;
  driveOffRouteForwardFraming: boolean;
  followingTemporaryGuidance: boolean;
  speedMps: number | null;
  allowDestinationPick: boolean;
  topdownZoomRef: MutableRefObject<number>;
  onMapClick: (lng: number, lat: number) => void;
  savedPlaces: SavedPlace[];
  savedPlacesVisible: boolean;
  onSavedPlaceClick: (id: string) => void;
  mapFocus: MapFocusRequest | null;
  onMapFocusComplete: () => void;
  orderedRouteIds: string[];
  radarMapOverlayOn: boolean;
  settingRadarDisplayMode: RadarDisplayMode;
  dataSaverMode: boolean;
  navMapLiteMode: boolean;
  isOnline: boolean;
  onRadarFrameUtcSec: (utcSec: number | null, meta?: RadarFrameHudMeta) => void;
  alongRouteAlerts: RouteAlert[];
  corridorRouteGeometry: LngLat[] | null | undefined;
  stormAlongRouteBands: StormProgressStripBand[];
  recordingActive: boolean;
  recordingPathPreview: LngLat[];
  weatherAlertGeoJson: GeoJSON.FeatureCollection | null;
  stormBarVisible: boolean;
  stormBarExpanded: boolean;
  recenterPlanningPuckTick: number;
  navigationGuidanceGeometry: LngLat[] | null | undefined;
  navPositionOnRoute: boolean;
  userAlongGuidanceM: number | null | undefined;
  isPlus: boolean;
  settingTrafficEnabled: boolean;
  hasMapboxToken: boolean;
  onDriveCameraBearingDeg: (deg: number | null) => void;
  trafficBypassCompare: TrafficBypassCompareState | null;
  lockedNavigationRouteId: string | null;
  activityTrailGeoJson: GeoJSON.FeatureCollection | null;
  guidanceRouteLengthM: number;
  maxPlanRouteLengthM: number;
  activityTrailPlanningBounds: [[number, number], [number, number]] | null;
  idleHomeMapFraming: HomeMapFraming;
  homePuckFollow: HomePuckFollowMode;
  /** True when there is no planned trip yet (home / idle map). */
  idleHomeNoRoutes: boolean;
  setHomePuckFollow: (mode: HomePuckFollowMode) => void;
  learnEnabled: boolean;
  homePreloadEnabled: boolean;
  homePreloadBounds: [[number, number], [number, number]] | null;
  searchPickMarkers: { id: string; lngLat: LngLat; label: string }[] | null;
  onSearchPickMarkerClick: ((id: string) => void) | undefined;
  progressRailVisible: boolean;
  offRouteRejoinCompareActive: boolean;
  followCamResyncKey?: number;
  lastTravelBearingDegOutRef?: MutableRefObject<number | null>;
  puckAnchorDriftPxOutRef?: MutableRefObject<number | null>;
  holdLastGoodMap?: boolean;
};

export function buildDriveMapProps(
  input: UseDriveMapPropsInput,
  onHomeMapUserPan: () => void
): DriveMapProps {
  const {
    routes,
    lineFocusId,
    suggestedRouteId,
    userLngLat,
    navigationStarted,
    liveLngLatRef,
    liveSpeedMpsRef,
    liveHeadingRef,
    destLngLat,
    viaStops,
    fitTrigger,
    viewMode,
    heading,
    driveRouteBearingDeg,
    driveOffRouteForwardFraming,
    followingTemporaryGuidance,
    speedMps,
    allowDestinationPick,
    topdownZoomRef,
    onMapClick,
    savedPlaces,
    savedPlacesVisible,
    onSavedPlaceClick,
    mapFocus,
    onMapFocusComplete,
    orderedRouteIds,
    radarMapOverlayOn,
    settingRadarDisplayMode,
    dataSaverMode,
    navMapLiteMode,
    isOnline,
    onRadarFrameUtcSec,
    alongRouteAlerts,
    corridorRouteGeometry,
    stormAlongRouteBands,
    recordingActive,
    recordingPathPreview,
    weatherAlertGeoJson,
    stormBarVisible,
    stormBarExpanded,
    recenterPlanningPuckTick,
    navigationGuidanceGeometry,
    navPositionOnRoute,
    userAlongGuidanceM,
    isPlus,
    settingTrafficEnabled,
    hasMapboxToken,
    onDriveCameraBearingDeg,
    trafficBypassCompare,
    lockedNavigationRouteId,
    activityTrailGeoJson,
    guidanceRouteLengthM,
    maxPlanRouteLengthM,
    activityTrailPlanningBounds,
    idleHomeMapFraming,
    homePuckFollow,
    learnEnabled,
    homePreloadEnabled,
    homePreloadBounds,
    searchPickMarkers,
    onSearchPickMarkerClick,
    progressRailVisible,
    offRouteRejoinCompareActive,
    followCamResyncKey = 0,
    lastTravelBearingDegOutRef,
    puckAnchorDriftPxOutRef,
    holdLastGoodMap = false,
  } = input;

  return {
    routes,
    lineFocusId,
    suggestedRouteId,
    userLngLat,
    liveGpsLngLatRef: navigationStarted ? liveLngLatRef : undefined,
    liveGpsSpeedMpsRef: navigationStarted ? liveSpeedMpsRef : undefined,
    liveGpsHeadingRef: navigationStarted ? liveHeadingRef : undefined,
    destLngLat,
    viaStops,
    fitTrigger,
    viewMode,
    navigationStarted,
    heading,
    driveRouteBearingDeg,
    driveOffRouteForwardFraming,
    followingTemporaryGuidance,
    speedMps,
    allowDestinationPick,
    topdownZoomRef,
    onMapClick,
    savedPlaces,
    savedPlacesVisible,
    onSavedPlaceClick,
    mapFocus,
    onMapFocusComplete,
    orderedRouteIds,
    showRadar: radarMapOverlayOn,
    radarAnimate:
      settingRadarDisplayMode === "motion" &&
      !dataSaverMode &&
      (!navMapLiteMode || radarMapOverlayOn),
    radarStormMotionArrows: settingRadarDisplayMode === "still_arrows",
    onRadarFrameUtcSec,
    alongRouteAlerts,
    corridorRouteGeometry,
    stormAlongRouteBands,
    recordingGeometry: recordingActive ? recordingPathPreview : undefined,
    weatherAlertGeoJson,
    stormBarVisible,
    stormBarExpanded,
    recenterPlanningPuckTick,
    puckSnapGeometry:
      navigationStarted && navigationGuidanceGeometry?.length
        ? navigationGuidanceGeometry
        : null,
    /* Keep snap while progress still trusts the corridor — latch alone used to
     * disable snap on GPS wobble and cause puck/camera thrash. */
    puckSnapEnabled: navigationStarted && navPositionOnRoute,
    snapSeedMeters:
      Number.isFinite(userAlongGuidanceM) && (userAlongGuidanceM ?? 0) >= 0
        ? userAlongGuidanceM!
        : null,
    userAlongMeters:
      navigationStarted && Number.isFinite(userAlongGuidanceM) ? userAlongGuidanceM! : null,
    trafficConditionsOnMap: Boolean(isPlus && settingTrafficEnabled && hasMapboxToken),
    onDriveCameraBearingDeg,
    stormBrowseBoundsReporting: false,
    onStormBrowseBoundsChange: undefined,
    trafficBypassCompareActive: Boolean(trafficBypassCompare),
    trafficBypassCompareHazardLngLat: trafficBypassCompare?.hazardLngLat ?? null,
    trafficBypassCompareHazardAlongMeters: trafficBypassCompare?.hazardAlongMeters ?? null,
    trafficBypassCompareKind: trafficBypassCompare?.compareKind,
    rejoinCompareLockedRouteId: lockedNavigationRouteId,
    activityTrailGeoJson,
    sessionRouteLengthM:
      guidanceRouteLengthM > 0 ? guidanceRouteLengthM : maxPlanRouteLengthM,
    activityTrailPlanningBounds,
    idleHomeMapFraming,
    homePuckFollow,
    onHomeMapUserPan,
    homePreloadEnabled: isPlus && learnEnabled && homePreloadEnabled,
    homePreloadBounds,
    searchPickMarkers,
    onSearchPickMarkerClick: searchPickMarkers ? onSearchPickMarkerClick : undefined,
    progressRailVisible,
    offRouteRejoinCompareActive,
    rejoinOverlayActive: offRouteRejoinCompareActive,
    followCamResyncKey,
    lastTravelBearingDegOutRef,
    puckAnchorDriftPxOutRef,
    isOnline,
    holdLastGoodMap,
  };
}

export function useDriveMapProps(input: UseDriveMapPropsInput): DriveMapProps {
  const { idleHomeNoRoutes, navigationStarted, setHomePuckFollow } = input;

  const onHomeMapUserPan = useCallback(() => {
    if (idleHomeNoRoutes && !navigationStarted) {
      setHomePuckFollow("explore");
    }
  }, [idleHomeNoRoutes, navigationStarted, setHomePuckFollow]);

  return buildDriveMapProps(input, onHomeMapUserPan);
}
