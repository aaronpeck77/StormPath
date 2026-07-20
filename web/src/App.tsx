import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getWebEnv } from "./config/env";
import { useFusedSituation } from "./hooks/useFusedSituation";
import { useSavedPlaces } from "./hooks/useSavedPlaces";
import { useSavedRoutes } from "./hooks/useSavedRoutes";
import { useRouteRecorder } from "./hooks/useRouteRecorder";
import { useSessionOdometerMeters } from "./hooks/useSessionOdometerMeters";
import { useAppLayerPrefs, shouldShowDataSaverHint } from "./hooks/useAppLayerPrefs";
import {
  useUserLocation,
  getDevLocationOverrideLngLat,
  GPS_STATE_THROTTLE_MS_NORMAL,
  GPS_STATE_THROTTLE_MS_ULTRA_LONG,
} from "./hooks/useUserLocation";
import { useDestinationSearch } from "./hooks/useDestinationSearch";
import { useNavigationPosition } from "./hooks/useNavigationPosition";
import { useNativeNavSession } from "./nav/useNativeNavSession";
import { useOpenWeatherNowcast } from "./hooks/useOpenWeatherNowcast";
import { useTrafficOverlayFetch } from "./hooks/useTrafficOverlayFetch";
import { resolveNavigationRouteIds } from "./nav/navigationRouteFocus";
import {
  loadReturnTripLeg,
  shortenReturnTripLabel,
  type ReturnTripLeg,
} from "./nav/returnTripLeg";
import type { LngLat } from "./nav/types";
import { pickSuggestedActive, scoreTrip } from "./scoring/scoreRoutes";
import { useAppForeground } from "./hooks/useAppForeground";
import { useTollPreview } from "./nav/useTollPreview";
import {
  getNwsPollIntervalMs,
  isDataSaverMode,
  isLongTripRoute,
  isUltraLongTripRoute,
  quantizeRouteAlongForHeavyUi,
} from "./utils/dataSaver";
import {
  trafficCongestionAnchorFraction,
} from "./services/mapboxDirectionsTraffic";
import {
  closestAlongRouteMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./nav/routeGeometry";
import { stablePlanRoutesKey } from "./nav/tripNavDisplay";
import { useTripNavDisplayHealth } from "./nav/useTripNavDisplayHealth";
import { useTripSurfaceRecovery } from "./nav/useTripSurfaceRecovery";
import { computeRadarMapOverlayOn, isDriveNavMode } from "./nav/navResourceBudget";
import { useRouteAheadDerivations } from "./nav/useRouteAheadDerivations";
import { useProgressCalloutPanel } from "./nav/useProgressCalloutPanel";
import { useNavAlternateRouteRefresh } from "./nav/useNavAlternateRouteRefresh";
import { useRefreshAlternateRoutes } from "./nav/useRefreshAlternateRoutes";
import { useProgressRailChrome } from "./nav/useProgressRailChrome";
import { useRoutePickItems } from "./nav/buildRoutePickItems";
import { useDriveEtaLabels } from "./nav/useDriveEtaLabels";
import { useSeriousHazardAutoFly } from "./nav/useSeriousHazardAutoFly";
import { isDriveOffRouteForwardFraming } from "./nav/driveAlwaysAhead";
import { unifiedTrafficNarrative } from "./nav/trafficNarrative";
import {
  TRAFFIC_BYPASS_ENABLED,
} from "./nav/constants";
import { useRouteWeatherPipeline } from "./forecast/useRouteWeatherPipeline";
import type { TrafficOverlay } from "./situation/fusedSnapshot";
import type { MapViewMode } from "./ui/driveMapTypes";
import { stormpathVersionLabel } from "./appVersion";
import { applyLayerStartupMigrations } from "./layerStartupPrefs";
import { AppMapStage } from "./ui/AppMapStage";
import { buildAppShellClassName, buildDevPointerStyle } from "./ui/appShellChrome";

const SavedDestinationsDrawer = lazy(() =>
  import("./ui/SavedDestinationsDrawer").then((m) => ({ default: m.SavedDestinationsDrawer }))
);
import type { SearchSuggestion } from "./ui/SearchBar";
import { AppBottomChrome } from "./ui/AppBottomChrome";
import { AppAboutSheetHost } from "./ui/AppAboutSheetHost";
import {
  currentNavTarget,
} from "./nav/routeWaypoints";
import {
  isFullSlotPermutation,
  reconcileSlotOrderWithPlan,
  slotOrderAfterSelect,
} from "./nav/routeSlotOrder";
import { useDebouncedBusyLabel } from "./hooks/useDebouncedBusyLabel";
import { buildAdvisoryRoadDetailRows } from "./ui/buildAdvisoryRoadDetailRows";
import { PendingSaveSheets } from "./ui/PendingSaveSheets";
import { AppStatusBanners } from "./ui/AppStatusBanners";
import { useDemoBypassPlayback } from "./nav/useDemoBypassPlayback";
import { useDriveApproachBanner } from "./nav/useDriveApproachBanner";
import { useDriveMapOverlays } from "./nav/useDriveMapOverlays";
import { useTrafficBypassFlow } from "./nav/useTrafficBypassFlow";
import { useSavedTripActions, useRecordedSaveLabels } from "./hooks/useSavedTripActions";
import { useAdvisoryInteractions } from "./hooks/useAdvisoryInteractions";
import { usePayTierSession } from "./hooks/usePayTierSession";
import { AppHazardSheetsHost } from "./ui/AppHazardSheetsHost";
import { AppProgressRail } from "./ui/AppProgressRail";
import { AppTopNavCluster } from "./ui/AppTopNavCluster";
import { Coachmarks } from "./ui/Coachmarks";
import { resetAllCoachmarks } from "./ui/coachmarks/firstLaunchSteps";
import { pointAlongPolyline } from "./ui/geometryAlong";
import type { NormalizedWeatherAlert } from "./weatherAlerts/types";
import { useBasicAdMobBanner } from "./hooks/useBasicAdMobBanner";
import { learnedClusterToSavedRoute } from "./frequentRoutes/learnedToSaved";
import { useFrequentRouteLearning } from "./hooks/useFrequentRouteLearning";
import { usePersonalForkNav } from "./hooks/usePersonalForkNav";
import { isPersonalForkRouteId, PERSONAL_FORK_ROUTE_ID } from "./personalForks";
import { useAppMapChromeProps } from "./ui/useAppMapChromeProps";
import {
  readHomeMapFraming,
  type HomeMapFraming,
} from "./map/homeMapFraming";
import {
  readHomePuckFollow,
  writeHomePuckFollow,
  type HomePuckFollowMode,
} from "./map/homePuckFollow";
import { readHomePreloadEnabled } from "./map/homePreloadRegion";
import {
  ACTIVITY_MIN_SAMPLES_RANK,
  ACTIVITY_SAMPLES_UPDATED_EVENT,
  rankSearchSuggestionsByTrailCentroid,
} from "./frequentRoutes/activitySamples";
import { useActivityTrailMap } from "./hooks/useActivityTrailMap";
import { BYPASS_HEAVY_DELAY_MINUTES } from "./nav/constants";
import { useActiveTripCache } from "./nav/useActiveTripCache";
import { computeDriveRouteBearing } from "./nav/computeDriveRouteBearing";
import { useForecastPlaceLabel } from "./hooks/useForecastPlaceLabel";
import { useBasemapNight } from "./hooks/useBasemapNight";
import {
  type TrafficBypassCompareState,
  useRouteCompareStore,
} from "./state/routeCompareStore";
import { useComputeRoutes } from "./nav/useComputeRoutes";
import { useTripLifecycle } from "./nav/useTripLifecycle";
import { useOffRouteNavigation } from "./nav/useOffRouteNavigation";
import { useStormCorridorPolling } from "./nav/useStormCorridorPolling";
import { useWeatherKitAlerts } from "./nav/useWeatherKitAlerts";
import { useArrivalDetection } from "./nav/useArrivalDetection";
import { useMapboxTrafficLineSnap } from "./nav/useMapboxTrafficLineSnap";
import { mapMatchingBuildAllowed } from "./services/mapboxMapMatching";
import { useNavigationGuidance } from "./nav/useNavigationGuidance";
import { useSettingsStore } from "./state/settingsStore";
import { useRouteCompareActions } from "./state/useRouteCompareActions";
import { useTripPlanStore } from "./state/tripPlanStore";
import { useUiStore } from "./state/uiStore";
import { useWeatherStore } from "./state/weatherStore";
import { safeStorage } from "./storage/safeStorage";
import {
  loadPreferredAreaRouteMap,
  type PreferredAreaRouteMap,
} from "./preferredAreaRoutes";
import "./App.css";

/* `PendingSave` lives in `state/uiStore.ts` (Phase 4e5a). The type is exported from there
 * for future consumers; App.tsx no longer references it directly because the `useState<…>`
 * annotation moved into the store. */

/** Route mode: refresh B/C alternates only (primary leg unchanged). */

export default function App() {
  applyLayerStartupMigrations();
  const env = useMemo(() => getWebEnv(), []);
  const {
    payTierProbeKey,
    reprobePayTier,
    isPlus,
    savedPlacesMax,
    savedRoutesMax,
    tollBypassEnabled,
    advisoryPromoLines,
    basicStatusPanelPromos,
    demoBypassTrafficJamPlus,
    demoBypassTrafficJamPlusRef,
    payFrequentRoutes,
    tierLabel,
    isOnline,
  } = usePayTierSession({ env });
  /* Settings now live in `useSettingsStore` (Phase 4a). Local names are kept identical so the
   * ~50 read sites and the AboutSheet wiring stay unchanged; the store handles persistence to
   * Capacitor Preferences via `safeStorage` so the per-flag persistence useEffects below could
   * disappear. Any *side-effects* on toggle (clearing storm state, setting overlay = undefined,
   * etc.) stay in App-owned useEffects because they touch App-owned refs/state. */
  const settingGpsHighRefreshEnabled = useSettingsStore((s) => s.gpsHighRefreshEnabled);
  const settingMapMatchingEnabled = useSettingsStore((s) => s.mapMatchingEnabled);
  /** Landscape / side view only — CSS mirrors chrome when "left"; portrait ignores */
  const settingLandscapeSideHand = useSettingsStore((s) => s.landscapeSideHand);
  /* Phase 4e3: the About sheet is the only consumer of the individual `setSettingX` setters.
   * `applySettings` writes through all 8 fields in one batched store update and runs each
   * persistence side once. Per-toggle handlers elsewhere (toolbar Radar overlay, etc.) operate
   * on App-owned state (`showRadar`), not on the persistent settings, so they don't need the
   * individual setters either. */
  const tripPlanForGps = useTripPlanStore((s) => s.plan);
  const navActiveForGps = useTripPlanStore((s) => s.navigationStarted);
  const maxRouteLenForGps = useMemo(() => {
    let max = 0;
    for (const r of tripPlanForGps.routes) {
      if (r.geometry && r.geometry.length >= 2) {
        max = Math.max(max, polylineLengthMeters(r.geometry));
      }
    }
    return max;
  }, [tripPlanForGps.routes]);
  const gpsStateThrottleMs =
    navActiveForGps && isUltraLongTripRoute(maxRouteLenForGps)
      ? GPS_STATE_THROTTLE_MS_ULTRA_LONG
      : navActiveForGps
        ? 200
        : GPS_STATE_THROTTLE_MS_NORMAL;
  const {
    lngLat: userLngLat,
    heading,
    speedMps,
    error: locationError,
    fixSource: locationFixSource,
    liveLngLatRef,
    liveHeadingRef,
    liveSpeedMpsRef,
  } = useUserLocation(true, {
    highRefresh: settingGpsHighRefreshEnabled,
    stateUpdateThrottleMs: gpsStateThrottleMs,
  });
  const devLocOverrideLngLat = import.meta.env.DEV ? getDevLocationOverrideLngLat() : null;
  const userLngLatRef = useRef(userLngLat);
  userLngLatRef.current = userLngLat;
  const speedMpsRef = useRef(speedMps);
  speedMpsRef.current = speedMps;
  const headingRef = useRef(heading);
  headingRef.current = heading;

  const {
    suggestedClusters,
    learnEnabled,
    setLearnEnabled,
    dismissCluster,
    recordLearnedTrip,
    resetTripLearningMachine,
    flushActiveLearnedTrip,
  } = useFrequentRouteLearning({
    payUnlocked: payFrequentRoutes,
    userLngLat,
    speedMps,
    mapboxToken: env.mapboxToken,
  });

  const navGoStartedAtRef = useRef<number | null>(null);
  const navGoGeometryRef = useRef<LngLat[] | null>(null);
  /** Planned main at Go — kept even after committing a personal fork (for fork learning). */
  const navPlannedMainGeometryRef = useRef<LngLat[] | null>(null);
  /** Full step geometry for guidance math — separate from display-tier plan state. */
  const navigationGuidanceGeometryRef = useRef<LngLat[] | null>(null);
  const [guidanceGeometryEpoch, setGuidanceGeometryEpoch] = useState(0);
  const [alongHoldResetKey, setAlongHoldResetKey] = useState(0);
  /** Route id locked at Go — guidance follows this until the driver explicitly switches legs. */
  const lockedNavigationRouteIdRef = useRef<string | null>(null);
  /** Suppress off-route rejoin while on a learned "Your route" fork. */
  const onPersonalForkRef = useRef(false);

  const ACTIVITY_TRAIL_MAP_LS = "stormpath-activity-trail-map-on";
  const [activityTrailMapOn, setActivityTrailMapOn] = useState(() => {
    return safeStorage.get(ACTIVITY_TRAIL_MAP_LS) === "1";
  });
  const [homeMapFraming, setHomeMapFraming] = useState<HomeMapFraming>(() => readHomeMapFraming());
  const [homePuckFollow, setHomePuckFollow] = useState<HomePuckFollowMode>(() => readHomePuckFollow());
  const [homePreloadEnabled, setHomePreloadEnabled] = useState(() => readHomePreloadEnabled());
  const [activityTrailTick, setActivityTrailTick] = useState(0);
  useEffect(() => {
    const on = () => setActivityTrailTick((n) => n + 1);
    window.addEventListener(ACTIVITY_SAMPLES_UPDATED_EVENT, on);
    return () => window.removeEventListener(ACTIVITY_SAMPLES_UPDATED_EVENT, on);
  }, []);

  const rankSearchSuggestionsWithTrail = useCallback(
    (items: SearchSuggestion[]) =>
      rankSearchSuggestionsByTrailCentroid(items, Boolean(isPlus && learnEnabled), ACTIVITY_MIN_SAMPLES_RANK),
    [isPlus, learnEnabled]
  );

  /** Map (Mp) follow: street-level on the puck while navigating — not route-wide Rt framing. */
  const topdownZoomRef = useRef(16);

  const { places: savedPlaces, showOnMap, setShowOnMap, addPlace, updateName, removePlace, canAddPlace } =
    useSavedPlaces(savedPlacesMax);
  const {
    routes: savedTripRoutes,
    addRoute: addSavedTripRoute,
    updateName: updateSavedTripRouteName,
    removeRoute: removeSavedTripRoute,
    canAddRoute,
  } = useSavedRoutes(savedRoutesMax);

  const {
    active: recordingActive,
    pointCount: recordingPointCount,
    lengthMeters: recordingLengthM,
    pathPreview: recordingPathPreview,
    start: startRouteRecording,
    ingest: ingestRouteSample,
    discard: discardRouteRecording,
    tryFinishRecording,
  } = useRouteRecorder();
  /* Ephemeral overlay state lives in `useUiStore` (Phase 4e5a). Local names + setter
   * signatures preserved so the dozens of read/setter sites in this file stay unchanged.
   * `dismissAllOverlays()` from the store collapses 11 setter calls into a single batched
   * update — used by the route-compare dismiss helper. */
  const pendingSave = useUiStore((s) => s.pendingSave);
  const setPendingSave = useUiStore((s) => s.setPendingSave);
  const aboutOpen = useUiStore((s) => s.aboutOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  /** Bumps DriveMap to hard-snap follow-cam after sheets / background. */
  const [followCamResyncKey, setFollowCamResyncKey] = useState(0);
  /* Contextual one-shot coachmarks — the {@link Coachmarks} component watches for its
   * tracked targets to become visible and pops a single "Tip" card next to each the first
   * time the user encounters it. Persistence + queue logic live entirely in that component;
   * App.tsx just owns the replay-key bump used by About → Help → Replay quick tour. */
  const [coachmarksReplayKey, setCoachmarksReplayKey] = useState(0);
  const handleReplayCoachmarks = () => {
    resetAllCoachmarks();
    setAboutOpen(false);
    /* Bump on next tick so the About sheet's exit animation has started before the queue
     * begins measuring elements (avoids the queue picking the About sheet's own contents
     * as a "visible target"). */
    window.setTimeout(() => setCoachmarksReplayKey((k) => k + 1), 350);
  };

  /** Never persisted — each route session starts closed; cleared when the plan changes or the trip is stopped. */
  const progressCalloutsOpen = useUiStore((s) => s.progressCalloutsOpen);
  const setProgressCalloutsOpen = useUiStore((s) => s.setProgressCalloutsOpen);
  const progressCalloutDetailScrollRef = useRef<HTMLDivElement | null>(null);

  const sheetsWereOpenRef = useRef(false);
  useEffect(() => {
    const open = aboutOpen || progressCalloutsOpen;
    /* navActiveForGps === navigationStarted from tripPlanStore (declared later in this component). */
    if (sheetsWereOpenRef.current && !open && navActiveForGps) {
      window.setTimeout(() => setFollowCamResyncKey((k) => k + 1), 80);
    }
    sheetsWereOpenRef.current = open;
  }, [aboutOpen, progressCalloutsOpen, navActiveForGps]);

  /* Settings (persisted) — toggles that actually reduce background API calls.
   * Sourced from `useSettingsStore` (Phase 4a). Individual `setSettingX` selectors were
   * dropped in Phase 4e3 — the only consumer (About sheet) now goes through `applySettings`. */
  const settingStormEnabled = useSettingsStore((s) => s.stormEnabled);
  const settingTrafficEnabled = useSettingsStore((s) => s.trafficEnabled);
  const settingWeatherHintsEnabled = useSettingsStore((s) => s.weatherHintsEnabled);
  const settingAutoRerouteEnabled = useSettingsStore((s) => s.autoRerouteEnabled);
  const isPlusRef = useRef(isPlus);
  isPlusRef.current = isPlus;
  const settingRadarEnabled = useSettingsStore((s) => s.radarEnabled);
  const settingDataSaverEnabled = useSettingsStore((s) => s.dataSaverEnabled);
  const dataSaverHintDismissed = useSettingsStore((s) => s.dataSaverHintDismissed);
  const dismissDataSaverHintAction = useSettingsStore((s) => s.dismissDataSaverHint);
  const appForeground = useAppForeground();
  const navigationMatchGeometryRef = useRef<LngLat[] | undefined>(undefined);
  const dataSaverMode = isDataSaverMode(settingDataSaverEnabled);

  const settingVoiceGuidanceEnabled = useSettingsStore((s) => s.voiceGuidanceEnabled);
  /* Storm/advisory state lives in `useWeatherStore` (Phase 4d). Local names + setter
   * signatures preserved so the ~40 read/setter sites in this file are unchanged. The store
   * action for `setStormBarExpanded` writes through to `safeStorage` so persistence and React
   * state can't drift; `collapseStormBarTransient` covers the route-compare dismiss case that
   * must NOT persist. */
  const stormCorridorAlerts = useWeatherStore((s) => s.stormCorridorAlerts);
  const setStormCorridorAlerts = useWeatherStore((s) => s.setStormCorridorAlerts);
  const setStormOverlapping = useWeatherStore((s) => s.setStormOverlapping);
  const stormMapGeoJson = useWeatherStore((s) => s.stormMapGeoJson);
  const setStormMapGeoJson = useWeatherStore((s) => s.setStormMapGeoJson);
  /** True once we have polygons or corridor alerts; avoids flashing "Loading NWS" on refresh. */
  const stormMapHasDisplayableRef = useRef(false);
  const stormCorridorAlertsRef = useRef(stormCorridorAlerts);
  stormCorridorAlertsRef.current = stormCorridorAlerts;
  const stormLoading = useWeatherStore((s) => s.stormLoading);
  const setStormLoading = useWeatherStore((s) => s.setStormLoading);
  const setStormError = useWeatherStore((s) => s.setStormError);
  const stormBarExpanded = useWeatherStore((s) => s.stormBarExpanded);
  const setStormBarExpanded = useWeatherStore((s) => s.setStormBarExpanded);
  /* `collapseStormBarTransient` is consumed inside `useRouteCompareActions` directly; App.tsx
   * no longer needs to subscribe to it. */
  /**
   * Baseline advisory stream:
   * - Basic: follows Storm setting.
   * - Plus: keep life-safety alerts/messages available even when Plus detail toggles are off.
   */
  const advisoryLifeSafetyOn = useMemo(
    () => env.stormAdvisoryEnabled,
    [env.stormAdvisoryEnabled]
  );
  /** Full Plus detail stream (all NWS + extended scroll content) when Storm is enabled. */
  const advisoryPlusDetailOn = useMemo(
    () => isPlus && settingStormEnabled,
    [isPlus, settingStormEnabled]
  );
  /** Passed into Mapbox routing — leg C may use an NWS-informed waypoint detour (Plus + Storm on). */
  const stormAlertsForRouting = useMemo((): NormalizedWeatherAlert[] | undefined => {
    if (!isPlus || !settingStormEnabled || stormCorridorAlerts.length === 0) return undefined;
    return stormCorridorAlerts;
  }, [isPlus, settingStormEnabled, stormCorridorAlerts]);
  /* Trip-plan + view-mode + destination state lives in `useTripPlanStore` (Phase 4b).
   * Local names + setter signatures match the prior `useState` API exactly so the ~120 read
   * sites and ~30 setter call sites in this file are unchanged. */
  const plan = useTripPlanStore((s) => s.plan);
  const setPlan = useTripPlanStore((s) => s.setPlan);
  const destLngLat = useTripPlanStore((s) => s.destLngLat);
  const setDestLngLat = useTripPlanStore((s) => s.setDestLngLat);
  const destinationLabel = useTripPlanStore((s) => s.destinationLabel);
  const setDestinationLabel = useTripPlanStore((s) => s.setDestinationLabel);
  const viaStops = useTripPlanStore((s) => s.viaStops);
  const activeViaIndex = useTripPlanStore((s) => s.activeViaIndex);
  const searchExpanded = useUiStore((s) => s.searchExpanded);
  const setSearchExpanded = useUiStore((s) => s.setSearchExpanded);
  /** Bumped on Stop/clear — in-flight route fetches must not call setPlan after the user cleared the trip. */
  const routeGraphEpochRef = useRef(0);
  /** Cancels the active primary Directions request when the user starts a new route, reroutes, or clears. */
  const routeMainFetchAbortRef = useRef<AbortController | null>(null);
  /** B/C refresh while driving — separate from {@link routeMainFetchAbortRef} so it does not cancel a new trip build. */
  const altRoutesFetchAbortRef = useRef<AbortController | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const routingRef = useRef(routing);
  routingRef.current = routing;

  /** B/C leg refresh — must not flip global `routing` (advisory shows "Building routes…"). */
  const altRoutesRefreshInFlightRef = useRef(false);
  const [tapHint, setTapHint] = useState<string | null>(null);
  const [returnTripLeg, setReturnTripLeg] = useState<ReturnTripLeg | null>(() => loadReturnTripLeg());
  const [fitTrigger, setFitTrigger] = useState(0);
  const [recenterPlanningPuckTick, setRecenterPlanningPuckTick] = useState(0);
  const navigationStarted = useTripPlanStore((s) => s.navigationStarted);
  const setNavigationStarted = useTripPlanStore((s) => s.setNavigationStarted);
  const navigationStartedRef = useRef(navigationStarted);
  navigationStartedRef.current = navigationStarted;
  const userAlongGuidanceMRef = useRef(0);
  const guidanceRouteGeomRef = useRef<LngLat[] | null>(null);
  const guidanceRouteLengthMRef = useRef(0);
  const navigationPositionLngLatRef = useRef<LngLat | null>(null);

  const destLngLatRef = useRef(destLngLat);
  destLngLatRef.current = destLngLat;
  const viaStopsRef = useRef(viaStops);
  viaStopsRef.current = viaStops;
  const activeViaIndexRef = useRef(activeViaIndex);
  activeViaIndexRef.current = activeViaIndex;
  const destinationLabelRef = useRef(destinationLabel);
  destinationLabelRef.current = destinationLabel;
  const navTargetLngLat = useMemo(
    () => currentNavTarget(viaStops, activeViaIndex, destLngLat),
    [viaStops, activeViaIndex, destLngLat]
  );
  const navTargetRef = useRef(navTargetLngLat);
  navTargetRef.current = navTargetLngLat;
  const viewMode = useTripPlanStore((s) => s.viewMode);
  const setViewMode = useTripPlanStore((s) => s.setViewMode);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const handleViewModeChange = useCallback(
    (next: MapViewMode) => {
      setViewMode(next);
      if (next === "route") setFitTrigger((n) => n + 1);
    },
    [setViewMode]
  );
  /* `viewModeBeforeTrafficBypass` moved into `state/uiStore.ts` (Phase 4e5a) as a module-local
   * imperative variable + thin getter/setter — same pattern as `tollCompareContext` in 4c.
   * The route-compare cancel/confirm handlers read it once via `getViewModeBeforeTrafficBypass()`
   * and clear it via `setViewModeBeforeTrafficBypass(null)`. */

  const driveModeUi = isDriveNavMode(navigationStarted, viewMode);
  /** Third-party AdMob only — house promos (SiteBible, Plus upsell) live in StormAdvisoryBar. */
  const basicAdBanner = useBasicAdMobBanner({
    enabled: !isPlus,
    navigationStarted,
    payTierProbeKey,
  });
  /** NWS polygons + fetches follow About → NWS everywhere (including drive — no auto-on). */
  const savedDrawerOpen = useUiStore((s) => s.savedDrawerOpen);
  const setSavedDrawerOpen = useUiStore((s) => s.setSavedDrawerOpen);
  const [bypassBusy, setBypassBusy] = useState(false);
  /* Compare panel state lives in `useRouteCompareStore` (Phase 4c). Local names + setter
   * signature preserved so the ~30 reads / setters in this file are unchanged. */
  const trafficBypassCompare = useRouteCompareStore((s) => s.trafficBypassCompare);
  const setTrafficBypassCompare = useRouteCompareStore((s) => s.setTrafficBypassCompare);
  const trafficBypassCompareRef = useRef<TrafficBypassCompareState | null>(null);
  trafficBypassCompareRef.current = trafficBypassCompare;
  const [demoPlaybackAlongM, setDemoPlaybackAlongM] = useState<number | null>(null);
  /** When true, demo puck glides along the active leg at ~posted limit speed (`?demo=bypass` + Plus). */
  const [demoPlaybackPlaying, setDemoPlaybackPlaying] = useState(false);
  /** When true, fabricate a fake reroute-eligible impact ~1.4 mi ahead so the approach banner appears
   *  for testing — only honored under `?demo=bypass` + Plus + navigating. Tapping the banner in this
   *  mode opens the mock compare panel (no Mapbox network call). */
  const demoApproachBannerOn = useUiStore((s) => s.demoApproachBannerOn);
  const setDemoApproachBannerOn = useUiStore((s) => s.setDemoApproachBannerOn);
  const demoCloseHazardOn = useUiStore((s) => s.demoCloseHazardOn);
  const setDemoCloseHazardOn = useUiStore((s) => s.setDemoCloseHazardOn);
  /** At destination, stationary + no interaction → clearRoute; foreground idle timer only (not on app resume). */
  const [trafficOverlay, setTrafficOverlay] = useState<TrafficOverlay | undefined>(undefined);
  const trafficOverlayRef = useRef(trafficOverlay);
  trafficOverlayRef.current = trafficOverlay;
  const [trafficFetchDone, setTrafficFetchDone] = useState(true);
  const setMapFocus = useUiStore((s) => s.setMapFocus);
  /** Map bearing in drive mode — compass above the info button. */
  const [driveMapBearingDeg, setDriveMapBearingDeg] = useState<number | null>(null);
  const routeHazardSheet = useUiStore((s) => s.routeHazardSheet);
  const setRouteHazardSheet = useUiStore((s) => s.setRouteHazardSheet);
  const tollRoutePrompt = useRouteCompareStore((s) => s.tollRoutePrompt);
  const setTollRoutePrompt = useRouteCompareStore((s) => s.setTollRoutePrompt);
  const [tollAvoidBusy, setTollAvoidBusy] = useState(false);
  const [tollAvoidFailureNote, setTollAvoidFailureNote] = useState<string | null>(null);
  const tollAcceptedRouteIdsRef = useRef<Set<string>>(new Set());
  const pendingGoAfterTollRef = useRef(false);
  const { showRadar, setShowRadar } = useAppLayerPrefs({
    navigationStarted,
    settingTrafficEnabled,
    settingRadarEnabled,
    setTrafficOverlay,
  });
  /** Radar visible in Route/Map only — paused in drive and when backgrounded. */
  const radarMapOverlayOn = computeRadarMapOverlayOn(showRadar, driveModeUi, appForeground);
  const [radarFrameUtcSec, setRadarFrameUtcSec] = useState<number | null>(null);
  const seriousHazardAutoFlewRef = useRef<Set<string>>(new Set());
  const [safetyAck, setSafetyAck] = useState(() => {
    return safeStorage.get("stormpath-safety-ack-v1") === "1";
  });
  const routeSlotOrder = useTripPlanStore((s) => s.routeSlotOrder);
  const setRouteSlotOrder = useTripPlanStore((s) => s.setRouteSlotOrder);
  const previewLegIndex = useTripPlanStore((s) => s.previewLegIndex);
  const setPreviewLegIndex = useTripPlanStore((s) => s.setPreviewLegIndex);

  const preferredAreaRouteMapRef = useRef<PreferredAreaRouteMap>(loadPreferredAreaRouteMap());

  const resetNavigationPlanning = useCallback(() => {
    setNavigationStarted(false);
  }, []);

  useEffect(() => {
    const buildLabel = stormpathVersionLabel();
    console.info(
      `[stormpath boot] ${buildLabel}`,
      "tier:", tierLabel,
      "| mapboxToken:", env.mapboxToken ? "YES" : "NO",
      "| weatherKit:", env.weatherKitEnabled ? "YES" : "NO",
      "| tomorrowIo:", env.tomorrowIoApiKey ? "YES" : "NO",
      "| stormAdvisory:", env.stormAdvisoryEnabled,
      "| nwsBase:", env.nwsApiBase,
      "| trafficEnabled:", settingTrafficEnabled,
      "| weatherHints:", settingWeatherHintsEnabled,
      "| online:", isOnline
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Main route-build entry point now lives in `nav/useComputeRoutes.ts` (Phase 4e5c). The
   * hook subscribes to route-compare, trip-plan, and ui stores directly; the remaining 16
   * deps are App-owned (refs, env, pay-tier flags, App-owned setters). The returned function
   * keeps the same name + signature so the dozens of call sites below are unchanged. */
  const computeRoutes = useComputeRoutes({
    userLngLat,
    mapboxToken: env.mapboxToken,
    isPlus,
    stormAlertsForRouting,
    stormEnabled: settingStormEnabled,
    payFrequentRoutes,
    learnWhereIDrive: isPlus && learnEnabled,
    resetNavigationPlanning,
    routeGraphEpochRef,
    routeMainFetchAbortRef,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    preferredAreaRouteMapRef,
    setRouting,
    setRouteError,
    setTapHint,
    setTollAvoidFailureNote,
    setFitTrigger,
  });

  const {
    searchText,
    setSearchText,
    allowAutocomplete,
    setAllowAutocomplete,
    suggestions,
    setSuggestions,
    suggestLoading,
    setSuggestLoading,
    setSearchPickHits,
    searchPickQueryRef,
    addingViaStop,
    setAddingViaStop,
    handleRemoveViaStop,
    handleMapClick,
    handleSavedPlaceNavigate,
    handleSavedMarkerClick,
    handlePickSuggestion,
    handleSearchPickFromMap,
    handleSearch,
    searchPickMarkersForMap,
    handleSearchFieldBeginEditing,
    handleSearchFieldEndEditing,
    handleSearchCancelSuggestions,
    handleSearchDismiss,
    handleCompactDestOpen,
  } = useDestinationSearch({
    userLngLat,
    userLngLatRef,
    locationError,
    mapboxToken: env.mapboxToken,
    computeRoutes,
    navigationStarted,
    planRoutesLength: plan.routes.length,
    rankSearchSuggestionsWithTrail,
    activityTrailTick,
    savedPlaces,
    setSavedDrawerOpen,
    setFitTrigger,
    setTapHint,
    setRouting,
    setRouteError,
  });

  useEffect(() => {
    if (!recordingActive || !userLngLat) return;
    ingestRouteSample(userLngLat);
  }, [userLngLat, recordingActive, ingestRouteSample]);

  const planRef = useRef(plan);
  planRef.current = plan;
  const guidanceRouteIdRef = useRef("");
  const navRouteLengthMRef = useRef(0);
  const planRoutesKeyStable = useMemo(() => stablePlanRoutesKey(plan.routes), [plan.routes]);

  const currentNowcast = useOpenWeatherNowcast({
    isPlus,
    isOnline,
    openWeatherApiKey: env.openWeatherApiKey,
    weatherKitEnabled: env.weatherKitEnabled,
    userLngLat,
    userLngLatRef,
  });

  const { bumpTrafficRefresh } = useTrafficOverlayFetch({
    planRef,
    guidanceRouteIdRef,
    routingRef,
    navRouteLengthMRef,
    planRoutesKeyStable,
    guidanceGeometryEpoch,
    navigationStarted,
    isPlus,
    isOnline,
    settingTrafficEnabled,
    mapboxToken: env.mapboxToken,
    dataSaverMode,
    appForeground,
    userAlongGuidanceMRef,
    userLngLatRef: navigationPositionLngLatRef,
    guidanceRouteGeomRef,
    setTrafficOverlay,
    setTrafficFetchDone,
  });

  const snap = useFusedSituation(plan, undefined, trafficOverlay);
  const scored = useMemo(() => scoreTrip(plan, snap, "balanced"), [plan, snap]);

  const primaryRouteId = plan.routes[0]?.id ?? "";
  const planRoutesKey = useMemo(() => plan.routes.map((r) => r.id).join("|"), [plan.routes]);
  const planRouteIds = useMemo(() => plan.routes.map((r) => r.id), [plan.routes]);
  const routeSlotOrderKey = useMemo(() => routeSlotOrder.join("|"), [routeSlotOrder]);

  useActiveTripCache({
    isPlus,
    plan,
    planRoutesKey,
    routeSlotOrder,
    routeSlotOrderKey,
    previewLegIndex,
    destLngLat,
    destinationLabel,
    navigationStarted,
    viewMode,
    fitTrigger,
    lockedNavigationRouteIdRef,
    setPlan,
    setDestLngLat,
    setDestinationLabel,
    setSearchText,
    setNavigationStarted,
    setViewMode,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setSearchExpanded,
    setAllowAutocomplete,
    setRouteError,
    setSuggestLoading,
    setSuggestions,
    setFitTrigger,
  });

  useEffect(() => {
    const ids = plan.routes.map((r) => r.id);
    if (!ids.length) return;
    let resetPreview = false;
    setRouteSlotOrder((prev) => {
      if (isFullSlotPermutation(prev, ids)) return prev;
      resetPreview = true;
      return [...ids];
    });
    setPreviewLegIndex((prev) => {
      if (resetPreview) return 0;
      return Math.min(Math.max(0, prev), ids.length - 1);
    });
  }, [planRoutesKey]);

  useEffect(() => {
    setProgressCalloutsOpen(false);
  }, [planRoutesKey]);

  useEffect(() => {
    if (!planRouteIds.length) return;
    if (!isFullSlotPermutation(routeSlotOrder, planRouteIds)) {
      setRouteSlotOrder((prev) => reconcileSlotOrderWithPlan(prev, planRouteIds));
    }
  }, [planRouteIds, routeSlotOrder]);

  const prevRouteCountRef = useRef(0);
  useEffect(() => {
    const prev = prevRouteCountRef.current;
    const next = plan.routes.length;
    prevRouteCountRef.current = next;
    if (navigationStarted) return;
    const targetCount = isPlus ? 2 : 1;
    if (prev < targetCount && next >= targetCount) {
      setViewMode("route");
      setFitTrigger((n) => n + 1);
    }
  }, [plan.routes.length, isPlus, navigationStarted]);

  /**
   * Hard guarantee: when a planning route fetch completes with routes available, we must be in Rt view.
   * This runs on every routing completion (even if route ids/count are unchanged).
   */
  useEffect(() => {
    if (navigationStarted) return;
    if (routing) return;
    if (!plan.routes.length) return;
    if (viewMode !== "route") setViewMode("route");
    setSearchExpanded(false);
  }, [routing, navigationStarted, plan.routes.length, viewMode]);

  /** 3D drive camera is only valid during active Go navigation — never leave Dr mode otherwise. */
  useEffect(() => {
    if (navigationStarted) return;
    if (viewMode !== "drive") return;
    setViewMode(plan.routes.length > 0 ? "route" : "topdown");
    if (plan.routes.length > 0) setFitTrigger((n) => n + 1);
    else setRecenterPlanningPuckTick((n) => n + 1);
  }, [navigationStarted, viewMode, plan.routes.length]);

  const prevDestLngLatRef = useRef<LngLat | null>(null);
  /** Every new destination → Rt view + map refit (endpoint pair before routes load, full trip after). */
  useEffect(() => {
    if (navigationStarted) return;
    if (!destLngLat) {
      prevDestLngLatRef.current = null;
      return;
    }
    const prev = prevDestLngLatRef.current;
    const destChanged =
      !prev ||
      Math.abs(prev[0] - destLngLat[0]) > 1e-8 ||
      Math.abs(prev[1] - destLngLat[1]) > 1e-8;
    if (!destChanged) return;
    prevDestLngLatRef.current = destLngLat;
    setViewMode("route");
    setSearchExpanded(false);
    setFitTrigger((n) => n + 1);
  }, [destLngLat, navigationStarted, setViewMode, setSearchExpanded]);

  /**
   * Replanning can replace A/B/C while keeping the same slot ids (`r-a|r-b|r-c`) and the same route
   * count — nothing else re-fires then. Force Rt + refit whenever the route graph changes.
   */
  useEffect(() => {
    if (navigationStarted) return;
    if (!plan.routes.length) return;
    setViewMode("route");
    setSearchExpanded(false);
    setFitTrigger((n) => n + 1);
  }, [planRoutesKey, navigationStarted]);

  const orderedRouteIds = useMemo(() => {
    if (isFullSlotPermutation(routeSlotOrder, planRouteIds)) return routeSlotOrder;
    return planRouteIds;
  }, [routeSlotOrder, planRouteIds]);

  const offRouteLockedRouteId =
    lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
  const offRouteGuidanceRoute = useMemo(
    () =>
      offRouteLockedRouteId
        ? plan.routes.find((r) => r.id === offRouteLockedRouteId)
        : undefined,
    [plan.routes, offRouteLockedRouteId, navigationStarted, orderedRouteIds]
  );
  const offRouteGuidanceRouteLengthM = useMemo(() => {
    const g = offRouteGuidanceRoute?.geometry;
    return g && g.length >= 2 ? polylineLengthMeters(g) : 0;
  }, [offRouteGuidanceRoute?.geometry]);

  const adoptLockedRouteGeometry = useCallback((geometry: LngLat[]) => {
    navigationGuidanceGeometryRef.current = geometry.map(([a, b]) => [a, b] as LngLat);
    navGoGeometryRef.current = navigationGuidanceGeometryRef.current;
    setGuidanceGeometryEpoch((n) => n + 1);
    setAlongHoldResetKey((n) => n + 1);
  }, []);

  /**
   * iOS Capacitor: Mapbox Navigation Core feeds puck/alongM; DIY snap/off-route pause.
   * Web / Netlify: hook is inert — DIY nav unchanged. Dr/Mp/Rt stay one DriveMap.
   */
  const {
    nativeNavActive,
    position: nativeNavPosition,
    guidance: nativeNavGuidance,
  } = useNativeNavSession({
    accessToken: env.mapboxToken,
    navigationStarted,
    coords: { userLngLat, viaStops, destLngLat },
    onRouteGeometry: adoptLockedRouteGeometry,
    voiceGuidanceEnabled: settingVoiceGuidanceEnabled,
  });

  const navPosition = useNavigationPosition({
    rawLngLat: userLngLat,
    navigationStarted: navActiveForGps && !nativeNavActive,
    guidanceGeometry: navigationMatchGeometryRef.current,
    alongHoldResetKey,
    mapboxToken: env.mapboxToken,
    isOnline,
    speedMps,
    appForeground,
    mapMatchingEnabled:
      mapMatchingBuildAllowed() &&
      settingMapMatchingEnabled &&
      isPlus &&
      Boolean(env.mapboxToken),
    disabled: Boolean(devLocOverrideLngLat) || nativeNavActive,
  });
  const effectiveNavPosition =
    nativeNavActive && nativeNavPosition ? nativeNavPosition : navPosition;
  const navigationPositionLngLat = effectiveNavPosition.positionLngLat;
  navigationPositionLngLatRef.current = navigationPositionLngLat;

  const offRouteNav = useOffRouteNavigation({
    userLngLat: navigationPositionLngLat,
    destLngLat,
    plan,
    orderedRouteIds,
    viaStops,
    activeViaIndex,
    destinationLabel,
    navigationStarted: navigationStarted && !nativeNavActive,
    guidanceRoute: offRouteGuidanceRoute,
    guidanceRouteLengthM: offRouteGuidanceRouteLengthM,
    guidanceRouteId: offRouteLockedRouteId ?? primaryRouteId,
    userAlongGuidanceMRef,
    effectiveUserLngLat: navigationPositionLngLat,
    mapboxToken: env.mapboxToken,
    isOnline,
    isPlus,
    effectiveAutoRerouteEnabled: settingAutoRerouteEnabled,
    settingVoiceGuidanceEnabled,
    settingStormEnabled,
    stormAlertsForRouting,
    lockedNavigationRouteIdRef,
    routeGraphEpochRef,
    altRoutesFetchAbortRef,
    altRoutesRefreshInFlightRef,
    navigationStartedRef,
    guidanceRouteGeomRef,
    userLngLatRef: navigationPositionLngLatRef,
    speedMpsRef,
    headingRef,
    navGoStartedAtRef,
    planRef,
    destLngLatRef,
    routingRef,
    setPlan,
    setDestLngLat,
    setRouteSlotOrder,
    setViewMode,
    setRouting,
    setRouteError,
    setTapHint,
    setFitTrigger,
    adoptLockedRouteGeometry,
    viewModeRef,
    onPersonalForkRef,
  });

  const {
    showOffRouteStatusBanner,
    autoRejoinGuidanceRouteId,
    offRouteLatched,
    offRouteRejoinAlongM,
    offRouteHoldPreviewActive,
    holdRejoinPreviewRouteId,
    resetOffRouteNavigation,
    clearDetourGuidance,
    detourAutoActive,
    detourRejoinDistanceLabel,
    stayOnThisRoad,
    returnToOriginalRoute,
  } = offRouteNav;

  /** After Go: NWS + corridor bands use the locked guidance leg, not the preview leg. */
  const nwsNavCorridorGeom = useMemo(() => {
    if (!navigationStarted) return undefined;
    const id =
      lockedNavigationRouteIdRef.current ?? orderedRouteIds[0];
    if (!id) return undefined;
    return plan.routes.find((r) => r.id === id)?.geometry;
  }, [navigationStarted, orderedRouteIds, plan.routes]);

  const nwsNavCorridorGeomKey = useMemo(() => {
    const g = nwsNavCorridorGeom;
    if (!g?.length) return "";
    const a = g[0]!;
    const b = g[g.length - 1]!;
    return `${g.length}:${a[0].toFixed(4)},${a[1].toFixed(4)}→${b[0].toFixed(4)},${b[1].toFixed(4)}`;
  }, [nwsNavCorridorGeom]);

  /** Invalidates NWS polling when any A/B/C geometry changes (planning only). */
  const nwsPlanRoutesGeomKey = useMemo(() => {
    return plan.routes
      .map((r) => {
        const g = r.geometry;
        if (!g?.length) return `${r.id}:0`;
        const a = g[0]!;
        const b = g[g.length - 1]!;
        return `${r.id}:${g.length}:${a[0].toFixed(4)},${a[1].toFixed(4)}→${b[0].toFixed(4)},${b[1].toFixed(4)}`;
      })
      .join("|");
  }, [plan.routes]);

  /**
   * While navigating, B/C alt-refreshes must not restart the NWS effect (was causing 450ms retry
   * storms + traffic refetch loops). After Go, key only the promoted primary leg.
   */
  const nwsEffectStableKey = useMemo(() => {
    if (navigationStarted && nwsNavCorridorGeomKey) {
      return `nav:${nwsNavCorridorGeomKey}`;
    }
    return `plan:${nwsPlanRoutesGeomKey}`;
  }, [navigationStarted, nwsNavCorridorGeomKey, nwsPlanRoutesGeomKey]);

  const nwsNavCorridorGeomRef = useRef<LngLat[] | undefined>(undefined);
  nwsNavCorridorGeomRef.current = nwsNavCorridorGeom;

  const planRoutesRef = useRef(plan.routes);
  planRoutesRef.current = plan.routes;

  /** Route view while navigating: refresh B/C from current GPS; keep primary (slot A) geometry unchanged. */
  const refreshAlternateRoutesOnly = useRefreshAlternateRoutes({
    navigationStarted,
    viewMode,
    userLngLat,
    destLngLat,
    mapboxToken: env.mapboxToken,
    isOnline,
    destinationLabel,
    stormAlertsForRouting,
    isPlus,
    settingStormEnabled,
    learnEnabled,
    orderedRouteIds,
    planRoutesLength: plan.routes.length,
    lockedNavigationRouteIdRef,
    routeGraphEpochRef,
    altRoutesRefreshInFlightRef,
    altRoutesFetchAbortRef,
    setPlan,
  });

  useEffect(() => {
    const n = orderedRouteIds.length;
    if (n === 0) return;
    setPreviewLegIndex((i) => Math.min(i, n - 1));
  }, [orderedRouteIds.length]);

  const { guidanceRouteId: resolvedGuidanceRouteId, lineFocusId: resolvedLineFocusId } =
    resolveNavigationRouteIds({
      navigationStarted,
      lockedRouteId: lockedNavigationRouteIdRef.current,
      temporaryGuidanceRouteId: autoRejoinGuidanceRouteId,
      viewMode,
      previewLegIndex,
      orderedRouteIds,
      primaryRouteId,
    });
  const lineFocusId = resolvedLineFocusId;
  const guidanceRouteId = resolvedGuidanceRouteId || primaryRouteId;
  guidanceRouteIdRef.current = guidanceRouteId;
  const lockedNavigationRouteId =
    lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? primaryRouteId;

  /** During A/B/C compare, highlight the leg the driver tapped (not only the current primary). */
  const driveMapLineFocusId =
    trafficBypassCompare?.selectedLeg ??
    (offRouteHoldPreviewActive && holdRejoinPreviewRouteId
      ? holdRejoinPreviewRouteId
      : lineFocusId);

  const suggestedRouteId = useMemo(() => {
    const id = pickSuggestedActive(scored);
    return id || null;
  }, [scored]);

  const { alternateBypassRouteId, routePickItems, routeDockDetail } = useRoutePickItems({
    plan,
    scored,
    suggestedRouteId,
    lineFocusId,
    orderedRouteIds,
  });

  const guidanceRoute = plan.routes.find((r) => r.id === guidanceRouteId);

  const navigationGuidanceGeometry = useMemo(() => {
    void guidanceGeometryEpoch;
    if (!navigationStarted || !guidanceRoute?.geometry?.length) {
      return guidanceRoute?.geometry;
    }
    if (guidanceRoute.id !== lockedNavigationRouteId) {
      return guidanceRoute.geometry;
    }
    return navigationGuidanceGeometryRef.current ?? guidanceRoute.geometry;
  }, [
    navigationStarted,
    guidanceRoute,
    guidanceRouteId,
    lockedNavigationRouteId,
    guidanceGeometryEpoch,
  ]);

  navigationMatchGeometryRef.current = navigationGuidanceGeometry ?? undefined;

  /** Longest planned leg — auto lean NWS fetch on cross-country trips (100+ mi). */
  const maxPlanRouteLengthM = useMemo(() => {
    let max = 0;
    for (const r of plan.routes) {
      if (r.geometry && r.geometry.length >= 2) {
        max = Math.max(max, polylineLengthMeters(r.geometry));
      }
    }
    return max;
  }, [plan.routes]);

  const showDataSaverHint = shouldShowDataSaverHint({
    isPlus,
    dataSaverMode,
    dataSaverHintDismissed,
    guidanceRouteGeometry: guidanceRoute?.geometry,
    maxPlanRouteLengthM,
  });
  const turnSteps = guidanceRoute?.turnSteps ?? [];
  const guidanceSliceRaw = snap.routes.find((r) => r.routeId === guidanceRouteId);

  /** Map NWS fill: active guidance leg (focused A/B/C), not only slot A after Go. */
  const nwsMapOverlapRouteGeom = useMemo((): LngLat[] | undefined => {
    const active = guidanceRoute?.geometry;
    if (active && active.length >= 2) return active;
    if (navigationStarted) {
      const g = nwsNavCorridorGeom;
      return g && g.length >= 2 ? g : undefined;
    }
    return undefined;
  }, [navigationStarted, nwsNavCorridorGeom, guidanceRoute?.geometry]);

  const leanNwsCorridorFetch =
    dataSaverMode || isLongTripRoute(maxPlanRouteLengthM) || isUltraLongTripRoute(maxPlanRouteLengthM);

  /** Data saver / long trip: one corridor (+ shared national feed) instead of every A/B/C leg each poll. */
  const nwsRouteGeomsForFetch = useMemo((): LngLat[][] => {
    const all = plan.routes
      .map((r) => r.geometry)
      .filter((g): g is LngLat[] => Boolean(g && g.length >= 2));
    if (!leanNwsCorridorFetch) return all;
    if (navigationStarted) {
      const g = nwsNavCorridorGeom;
      return g && g.length >= 2 ? [g] : all.length ? [all[0]!] : [];
    }
    const focused = plan.routes.find((r) => r.id === lineFocusId)?.geometry;
    if (focused && focused.length >= 2) return [focused];
    return all.length ? [all[0]!] : [];
  }, [leanNwsCorridorFetch, navigationStarted, nwsNavCorridorGeom, plan.routes, lineFocusId]);

  const nwsRouteGeomsForFetchRef = useRef(nwsRouteGeomsForFetch);
  nwsRouteGeomsForFetchRef.current = nwsRouteGeomsForFetch;

  const nwsPollIntervalMs = useMemo(
    () => getNwsPollIntervalMs(dataSaverMode, navigationStarted, maxPlanRouteLengthM, driveModeUi),
    [dataSaverMode, navigationStarted, maxPlanRouteLengthM, driveModeUi]
  );

  const liveTrafficNarrative = useMemo(() => {
    if (!guidanceSliceRaw || !guidanceRoute) return null;
    const tLeg = trafficOverlay?.[guidanceRouteId] ?? null;
    const hasLive = Boolean(guidanceSliceRaw.hasLiveTrafficEstimate && tLeg);
    return unifiedTrafficNarrative(
      guidanceSliceRaw.trafficDelayMinutes,
      tLeg,
      hasLive,
      tLeg?.mapboxDurationMinutes ?? guidanceRoute.baseEtaMinutes ?? null
    );
  }, [guidanceSliceRaw, guidanceRoute, guidanceRouteId, trafficOverlay]);

  const trafficDelayMinutesForBypass = useMemo(
    () =>
      Math.max(
        guidanceSliceRaw?.trafficDelayMinutes ?? 0,
        demoBypassTrafficJamPlus ? BYPASS_HEAVY_DELAY_MINUTES : 0
      ),
    [guidanceSliceRaw?.trafficDelayMinutes, demoBypassTrafficJamPlus]
  );

  /** With `?demo=bypass` on Plus, optional simulated distance along the primary leg (replay puck / jam-ahead context). */
  const effectiveUserLngLat = useMemo(() => {
    if (demoBypassTrafficJamPlus && demoPlaybackAlongM != null && guidanceRoute?.geometry?.length) {
      return pointAtAlongMeters(guidanceRoute.geometry, demoPlaybackAlongM);
    }
    return navigationStarted ? navigationPositionLngLat : userLngLat;
  }, [
    demoBypassTrafficJamPlus,
    demoPlaybackAlongM,
    guidanceRoute?.geometry,
    navigationStarted,
    navigationPositionLngLat,
    userLngLat,
  ]);

  const effectiveUserLngLatRef = useRef(effectiveUserLngLat);
  effectiveUserLngLatRef.current = effectiveUserLngLat;

  const basemapNight = useBasemapNight(
    effectiveUserLngLatRef,
    effectiveUserLngLat?.[0],
    effectiveUserLngLat?.[1]
  );

  const { forecastPlaceShort, forecastAreaLabel } = useForecastPlaceLabel({
    mapboxToken: env.mapboxToken,
    effectiveUserLngLat,
  });

  /** Bumps NWS effect when GPS becomes available for browse mode (no Go yet). */
  const nwsBrowseLocationReady = Boolean(effectiveUserLngLat);

  useStormCorridorPolling({
    appForeground,
    isPlus,
    stormAdvisoryEnabled: env.stormAdvisoryEnabled,
    advisoryLifeSafetyOn,
    settingStormEnabled,
    nwsEffectStableKey,
    nwsPollIntervalMs,
    nwsBrowseLocationReady,
    planRoutesLength: plan.routes.length,
    stormMapGeoJson,
    stormCorridorAlerts,
    stormCorridorAlertsRef,
    stormMapHasDisplayableRef,
    effectiveUserLngLatRef,
    nwsRouteGeomsForFetchRef,
    planRef,
    routingRef,
    setStormCorridorAlerts,
    setStormMapGeoJson,
    setStormOverlapping,
    setStormLoading,
    setStormError,
    setStormBarExpanded,
  });

  /** WeatherKit alerts at user location — supplementary to NWS for US; primary for international. */
  const wkAlerts = useWeatherKitAlerts({
    enabled: Boolean(env.weatherKitEnabled) && Boolean(isPlus) && Boolean(settingStormEnabled),
    userLngLat: effectiveUserLngLat ?? null,
    appForeground,
  });

  /**
   * Merged alert list for the advisory UI. NWS is primary (has geometry for map + routing);
   * WeatherKit adds international coverage and any extra local alerts without geometry.
   * Routing and overlap calculations still use NWS-only `stormCorridorAlerts`.
   */
  const allDisplayableAlerts = useMemo(
    () => [...stormCorridorAlerts, ...wkAlerts],
    [stormCorridorAlerts, wkAlerts]
  );

  /** Keeps progress-bar fill from snapping to ~0 when the active polyline is replaced (reroute). */
  const tripOdometerM = useSessionOdometerMeters(
    effectiveUserLngLat,
    navigationStarted,
    speedMps
  );

  const guidanceRouteLengthM = useMemo(() => {
    const g = navigationGuidanceGeometry ?? guidanceRoute?.geometry;
    return g && g.length >= 2 ? polylineLengthMeters(g) : 0;
  }, [navigationGuidanceGeometry, guidanceRoute?.geometry]);

  const {
    userAlongGuidanceM,
    bannerTurnIndex: diyBannerTurnIndex,
    metersToBannerManeuver: diyMetersToBannerManeuver,
  } = useNavigationGuidance({
    navigationStarted,
    /** Native Core owns spoken instructions on iOS; keep Web Speech for DIY/web. */
    settingVoiceGuidanceEnabled: settingVoiceGuidanceEnabled && !nativeNavActive,
    guidanceRouteId,
    guidanceRouteLengthM,
    turnSteps,
    effectiveUserLngLat: navigationPositionLngLat,
    routeGeometry: navigationGuidanceGeometry,
    alongHoldResetKey,
    navigationAlongM: navigationStarted ? effectiveNavPosition.alongM : undefined,
    frozenAlongM:
      driveModeUi
        ? undefined
        : offRouteLatched &&
            !autoRejoinGuidanceRouteId &&
            offRouteRejoinAlongM > 0
          ? offRouteRejoinAlongM
          : undefined,
    speedMps,
  });

  /** iOS Core: banner text/distance from Mapbox progress so DIY turnSteps can't drift. */
  const bannerTurnIndex = useMemo(() => {
    if (!nativeNavActive || !nativeNavGuidance || turnSteps.length === 0) {
      return diyBannerTurnIndex;
    }
    // Current Core step is in progress; upcoming maneuver is usually the next step.
    const next = nativeNavGuidance.stepIndex + 1;
    if (next >= 0 && next < turnSteps.length) return next;
    return Math.max(0, Math.min(nativeNavGuidance.stepIndex, turnSteps.length - 1));
  }, [nativeNavActive, nativeNavGuidance, turnSteps.length, diyBannerTurnIndex]);

  const metersToBannerManeuver =
    nativeNavActive && nativeNavGuidance?.stepRemainingM != null
      ? nativeNavGuidance.stepRemainingM
      : diyMetersToBannerManeuver;

  const bannerInstructionOverride =
    nativeNavActive && nativeNavGuidance?.instruction
      ? nativeNavGuidance.instruction
      : null;

  guidanceRouteGeomRef.current = navigationGuidanceGeometry ?? guidanceRoute?.geometry ?? null;
  guidanceRouteLengthMRef.current = guidanceRouteLengthM;
  navRouteLengthMRef.current = guidanceRouteLengthM;
  userAlongGuidanceMRef.current = userAlongGuidanceM;

  const guidanceIsPersonalFork =
    isPersonalForkRouteId(lockedNavigationRouteId) ||
    isPersonalForkRouteId(guidanceRouteId);

  const personalForkMainGeometry = useMemo(() => {
    if (navPlannedMainGeometryRef.current?.length) return navPlannedMainGeometryRef.current;
    if (guidanceIsPersonalFork) return null;
    return navigationGuidanceGeometry ?? guidanceRoute?.geometry ?? null;
  }, [
    guidanceIsPersonalFork,
    navigationGuidanceGeometry,
    guidanceRoute?.geometry,
    guidanceGeometryEpoch,
  ]);

  const personalForkNav = usePersonalForkNav({
    enabled: Boolean(payFrequentRoutes && learnEnabled),
    navigationStarted,
    viewMode,
    mainGeometry: personalForkMainGeometry,
    userLngLat: navigationPositionLngLat,
    userAlongMainM: userAlongGuidanceM,
    destLngLat,
    headingDeg: heading,
    guidanceIsPersonalFork,
    onPersonalForkRef,
  });

  /** Plan-time: attach a strong habitual fork as "Your route" beside A/B/C. */
  const injectYourRouteIntoPlan = personalForkNav.injectYourRouteIntoPlan;
  const lastInjectedPlanKeyRef = useRef<string>("");
  useEffect(() => {
    if (!payFrequentRoutes || !learnEnabled || navigationStarted) return;
    if (!destLngLat || plan.routes.length < 1) return;
    if (plan.routes.some((r) => isPersonalForkRouteId(r.id))) return;
    const key = `${destLngLat[0].toFixed(4)},${destLngLat[1].toFixed(4)}|${plan.routes
      .map((r) => r.id)
      .join(",")}`;
    if (lastInjectedPlanKeyRef.current === key) return;
    const next = injectYourRouteIntoPlan(plan, destLngLat);
    if (next.routes.length > plan.routes.length) {
      lastInjectedPlanKeyRef.current = key;
      setPlan(next);
    }
  }, [
    payFrequentRoutes,
    learnEnabled,
    navigationStarted,
    destLngLat,
    plan,
    injectYourRouteIntoPlan,
  ]);

  /** Advisory timeline / NWS distance — snap to GPS on the route when planning, not only after Go. */
  const advisoryUserAlongM = useMemo(() => {
    const g = guidanceRoute?.geometry;
    if (!g?.length) return 0;
    if (navigationStarted && Number.isFinite(userAlongGuidanceM) && userAlongGuidanceM >= 0) {
      return userAlongGuidanceM;
    }
    if (effectiveUserLngLat) {
      return closestAlongRouteMeters(effectiveUserLngLat, g).alongMeters;
    }
    return 0;
  }, [guidanceRoute?.geometry, navigationStarted, userAlongGuidanceM, effectiveUserLngLat]);

  /** Throttle heavy advisory recompute (timeline, impacts) — turn banner keeps precise along-m. */
  const heavyAdvisoryAlongM = useMemo(
    () =>
      quantizeRouteAlongForHeavyUi(
        advisoryUserAlongM,
        guidanceRouteLengthM,
        navigationStarted
      ),
    [advisoryUserAlongM, guidanceRouteLengthM, navigationStarted]
  );

  const speedMph = speedMps != null ? speedMps * 2.23694 : null;

  const driveOffRouteForwardFraming = useMemo(
    () =>
      isDriveOffRouteForwardFraming({
        driveModeUi,
        navigationStarted,
        onRoute: effectiveNavPosition.onRoute,
        offRouteLatched,
      }),
    [driveModeUi, navigationStarted, effectiveNavPosition.onRoute, offRouteLatched]
  );

  /** Drive camera: polyline ahead on-corridor; vehicle heading / motion when off route. */
  const driveRouteBearingDeg = useMemo(
    () =>
      computeDriveRouteBearing({
        driveOffRouteForwardFraming,
        driveModeUi,
        effectiveUserLngLat,
        geometry: guidanceRoute?.geometry,
        speedMps,
        navigationStarted,
        userAlongGuidanceM,
      }),
    [
      driveOffRouteForwardFraming,
      driveModeUi,
      effectiveUserLngLat,
      guidanceRoute?.geometry,
      guidanceRoute?.id,
      speedMps,
      navigationStarted,
      userAlongGuidanceM,
    ]
  );

  const { driveEtaMinutes, driveDistanceRemainingLabel } = useDriveEtaLabels({
    navigationStarted,
    scored,
    lineFocusId,
    guidanceRoute,
    guidanceRouteLengthM,
    userAlongGuidanceM,
    trafficOverlay,
    effectiveUserLngLat,
  });

  useTripNavDisplayHealth({
    navigationStarted,
    appForeground,
    lineFocusId,
    guidanceRouteId,
    planRoutes: plan.routes,
    scored,
    alongHoldResetKey,
    guidanceRouteLengthMRef,
    userAlongGuidanceMRef,
    guidanceRouteGeomRef,
    speedMpsRef,
    trafficOverlayRef,
    setAlongHoldResetKey,
    bumpTrafficRefresh,
  });

  const {
    showTrafficCorridorOnRoute,
    showRoadNoticesOnRoute,
    navResourceBudget,
    radarMosaicSamples,
    radarMosaicUpdatedAt,
    radarRefreshBlocked,
    tioMinutePrecip,
    localHourlyForecast,
    localDailyForecast,
    tioRouteForecast,
    bumpRouteForecastRefresh,
    routeForecastRefreshBlocked,
    routeWeatherReady,
    guidanceSlice,
    handleRefreshRouteInfoWeather,
    routeInfoWeatherRefreshing,
    routeInfoRefreshNote,
    routeInfoRefreshNoteTone,
    advisoryNowcastLine,
    enrichedCorridorWeatherDetail,
    localForecastPanelLoading,
    radarMosaicMaxIntensity,
  } = useRouteWeatherPipeline({
    isPlus,
    settingTrafficEnabled,
    destLngLat,
    planRoutes: plan.routes,
    guidanceRoute,
    guidanceRouteId,
    guidanceRouteLengthM,
    maxPlanRouteLengthM,
    navigationStarted,
    viewMode,
    appForeground,
    showRadar,
    dataSaverMode,
    settingStormEnabled,
    settingWeatherHintsEnabled,
    progressCalloutsOpen,
    stormBarExpanded,
    effectiveUserLngLat,
    speedMps,
    lineFocusId,
    guidanceSliceRaw,
    currentNowcast,
    weatherKitEnabled: env.weatherKitEnabled,
    tomorrowIoApiKey: env.tomorrowIoApiKey,
    openWeatherApiKey: env.openWeatherApiKey,
  });

  useTripSurfaceRecovery({
    appForeground,
    hasActiveTrip:
      navigationStarted ||
      Boolean(destLngLat && plan.routes.some((r) => r.geometry && r.geometry.length >= 2)),
    navigationStarted,
    orderedRouteIds,
    planRoutes: plan.routes,
    guidanceRouteId,
    routingInFlightRef: altRoutesRefreshInFlightRef,
    routingRef,
    setFitTrigger,
    setAlongHoldResetKey,
    bumpTrafficRefresh,
    bumpRouteForecastRefresh,
    advisoryForecastRepairEnabled: navResourceBudget.advisoryForecastRepairEnabled,
    onAutoRepair: () => {
      setTapHint("Refreshing trip display…");
      window.setTimeout(() => setTapHint(null), 3500);
    },
  });

  const {
    nwsAlertsAffectingActiveRoute,
    nwsAlertsForGuidanceAdvisory,
    stormNwsPuckInside,
    localForecastNwsAlerts,
    stormMapGeoJsonForMap,
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
    driveMapRoutes,
    progressRailRoute,
    postedMph,
    progressStripAlerts,
  } = useRouteAheadDerivations({
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
    corridorWeatherDetail: enrichedCorridorWeatherDetail,
    radarMosaicSamples,
    showTrafficCorridorOnRoute,
    showRoadNoticesOnRoute,
    driveEtaMinutes,
    viewMode,
    trafficDelayMinutesForBypass,
    mapboxToken: env.mapboxToken,
    destLngLat,
    settingTrafficEnabled,
    trafficBypassCompare,
    guidanceRouteId,
    planRoutes: plan.routes,
    lockedNavigationRouteId,
    temporaryGuidanceRouteId: autoRejoinGuidanceRouteId,
    offRouteHoldPreviewActive,
    stormMapGeoJson,
  });

  const { toggleDemoPlaybackPlaying, resetDemoPlaybackAlongRoute } = useDemoBypassPlayback({
    demoBypassTrafficJamPlus,
    navigationStarted,
    guidanceRoute,
    guidanceRouteId,
    postedMph,
    userLngLatRef,
    demoPlaybackAlongM,
    setDemoPlaybackAlongM,
    demoPlaybackPlaying,
    setDemoPlaybackPlaying,
  });

  const {
    driveApproachBannerPick,
    setDriveApproachDismissedIds,
    hazardApproachAlertsActive,
  } = useDriveApproachBanner({
    isPlus,
    navigationStarted,
    guidanceRoute,
    guidanceRouteId,
    userAlongGuidanceM,
    speedMps,
    routeImpactsForUi,
    demoBypassTrafficJamPlus,
    demoApproachBannerOn,
    demoCloseHazardOn,
  });


  const {
    driveMapRoutesForMap,
    deferredNwsAlertGeoJsonForMap,
    navMapLiteMode,
    deferredRouteImpactsForUi,
    mapAlongRouteAlertsForDrive,
    mapStormAlongRouteBandsForDrive,
    driveRouteAheadLine,
  } = useDriveMapOverlays({
    navigationGuidanceGeometry,
    driveMapRoutes,
    navigationStarted,
    guidanceRouteId,
    viewMode,
    personalForkPreviewGeometry: personalForkNav.previewGeometry,
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
  });

  const { progressPanelAlongM, activeProgressCalloutPanel, progressCalloutUserAlongT, progressCalloutCount } =
    useProgressCalloutPanel({
      navigationStarted,
      advisoryUserAlongM,
      userAlongGuidanceM,
      guidanceRouteLengthM,
      guidanceRoute,
      orderedRouteIds,
      guidanceRouteId,
      routeAheadTimeline,
      routeAheadProgressBands,
      stormCorridorAlerts: allDisplayableAlerts,
      progressStripAlerts,
      guidanceSlice,
      corridorWeatherDetail: enrichedCorridorWeatherDetail,
      lineFocusId,
      tioRouteForecast,
      radarMosaicSamples,
      liveTrafficNarrative,
      driveEtaMinutes,
      stormOutlookBands,
      advisoryNowcastLine,
      currentNowcast,
      tioMinutePrecip,
      localHourlyForecast,
      nwsAlertsAffectingActiveRoute,
      progressCalloutsOpen,
      progressCalloutDetailScrollRef,
      appForeground,
      isPlus,
      settingWeatherHintsEnabled,
      destLngLat,
      planRoutes: plan.routes,
      bumpRouteForecastRefresh,
      advisoryForecastRepairEnabled: navResourceBudget.advisoryForecastRepairEnabled,
      advisoryWeatherSyncEnabled: navResourceBudget.advisoryWeatherSyncEnabled,
      bumpTrafficRefresh,
    });

  const onStormBarExpandedChange = useCallback(
    (expanded: boolean) => {
      setStormBarExpanded(expanded);
      setFitTrigger((n) => n + 1);
    },
    [setStormBarExpanded]
  );

  /* Route-compare actions live in `useRouteCompareActions` (Phase 4e5b). The hook subscribes
   * to all four state stores (uiStore, routeCompareStore, weatherStore, tripPlanStore)
   * internally; the only App-owned dep is `setFitTrigger`. Names preserved so the existing
   * call sites in `handleTollPreview`, the hazard sheet handler, and the trip-bypass effects
   * stay unchanged. */
  const { activateRouteCompare } = useRouteCompareActions({
    setFitTrigger,
  });

  useMapboxTrafficLineSnap({
    navigationStarted,
    mapboxToken: env.mapboxToken,
    destLngLat,
    guidanceRoute,
    trafficFetchDone,
    routing,
    trafficOverlay,
    lineFocusId,
    userLngLatRef,
    routeGraphEpochRef,
    setPlan,
    setFitTrigger,
    setTapHint,
  });

  useNavAlternateRouteRefresh({
    appForeground,
    navigationStarted,
    viewMode,
    destLngLat,
    dataSaverMode,
    planRoutesLength: plan.routes.length,
    routingRef,
    altRoutesRefreshInFlightRef,
    refreshAlternateRoutesOnly,
  });

  useSeriousHazardAutoFly({
    navigationStarted,
    viewMode,
    guidanceRouteGeometry: guidanceRoute?.geometry,
    guidanceRouteId,
    userLngLat,
    heavyAdvisoryAlongM,
    deferredRouteImpactsForUi,
    seriousHazardAutoFlewRef,
    setMapFocus,
  });

  /** Rt + Mp: explore / plan on the map; Dr is follow-cam — keep tap-to-dest and ★ off there. */
  const mapPlanningUi = viewMode === "route" || viewMode === "topdown";
  const allowDestinationPick = mapPlanningUi;
  const routeActive = plan.routes.length > 0;
  const showCompactDest = routeActive && !searchExpanded;
  const showReturnTripButton =
    isPlus &&
    mapPlanningUi &&
    !navigationStarted &&
    !destLngLat &&
    !plan.routes.length &&
    Boolean(returnTripLeg?.geometry.length && returnTripLeg.geometry.length >= 2);
  const returnTripButtonLabel = returnTripLeg
    ? shortenReturnTripLabel(returnTripLeg.returnToLabel)
    : "";

  const {
    showStormAdvisoryChrome,
    showProgressRail,
    progressStripRouteColor,
    radarFrameClockLabel,
    radarFrameTimeLabel,
  } = useProgressRailChrome({
    isPlus,
    advisoryLifeSafetyOn,
    trafficBypassCompare,
    progressRailRoute,
    guidanceRoute,
    orderedRouteIds,
    navigationStarted,
    radarMapOverlayOn,
    radarFrameUtcSec,
  });

  const {
    activityTrailGeoJsonForMap,
    activityTrailPlanningBounds,
    homePreloadBounds,
    activityTrailAboutPanel,
    idleHomeMapFraming,
  } = useActivityTrailMap({
    isPlus,
    activityTrailMapOn,
    setActivityTrailMapOn,
    activityTrailMapLsKey: ACTIVITY_TRAIL_MAP_LS,
    learnEnabled,
    setLearnEnabled,
    homeMapFraming,
    setHomeMapFraming,
    homePreloadEnabled,
    setHomePreloadEnabled,
    activityTrailTick,
    bumpActivityTrailTick: () => setActivityTrailTick((n) => n + 1),
  });

  /* Phase 3c: Go / Stop / clear trip lifecycle (was inline in App). */
  const { clearRoute, proceedGo, handleGo, handleStopAndClear } = useTripLifecycle({
    payFrequentRoutes,
    learnEnabled,
    tollBypassEnabled,
    userLngLat,
    orderedRouteIds,
    primaryRouteId,
    planRouteIds,
    recordLearnedTrip,
    flushActiveLearnedTrip,
    resetTripLearningMachine,
    learnFromCompletedNav: personalForkNav.learnFromCompletedNav,
    resetOffRouteNavigation,
    resetNavigationPlanning,
    bumpRouteForecastRefresh,
    setAddingViaStop,
    setSearchText,
    setSearchPickHits,
    setSuggestions,
    setAllowAutocomplete,
    searchPickQueryRef,
    setFitTrigger,
    setGuidanceGeometryEpoch,
    setRecenterPlanningPuckTick,
    setReturnTripLeg,
    setRouting,
    setBypassBusy,
    setRouteError,
    setTollAvoidFailureNote,
    setDemoPlaybackPlaying,
    setDemoPlaybackAlongM,
    navigationStartedRef,
    navGoStartedAtRef,
    navGoGeometryRef,
    navPlannedMainGeometryRef,
    navigationGuidanceGeometryRef,
    lockedNavigationRouteIdRef,
    onPersonalForkRef,
    routeGraphEpochRef,
    routeMainFetchAbortRef,
    altRoutesFetchAbortRef,
    seriousHazardAutoFlewRef,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    preferredAreaRouteMapRef,
  });

  const clearRouteRef = useRef(clearRoute);
  clearRouteRef.current = clearRoute;
  const computeRoutesRef = useRef(computeRoutes);
  computeRoutesRef.current = computeRoutes;

  useArrivalDetection({
    demoBypassTrafficJamPlusRef,
    navigationStartedRef,
    navigationPositionLngLatRef,
    navTargetRef,
    guidanceRouteGeomRef,
    userAlongGuidanceMRef,
    guidanceRouteLengthMRef,
    speedMpsRef,
    viaStopsRef,
    activeViaIndexRef,
    destLngLatRef,
    destinationLabelRef,
    computeRoutesRef,
    clearRouteRef,
    setTapHint,
  });

  /** Make this leg the primary (slot A / blue); used after Go, hazard “use this route”, and bypass. */
  const handlePromoteRouteToPrimary = useCallback(
    (id: string) => {
      if (!plan.routes.some((r) => r.id === id)) return;
      setRouteSlotOrder((prev) => slotOrderAfterSelect(prev.length ? prev : planRouteIds, id));
      setPreviewLegIndex(0);
      if (navigationStartedRef.current) {
        lockedNavigationRouteIdRef.current = id;
        onPersonalForkRef.current = isPersonalForkRouteId(id);
      }
      clearDetourGuidance();
    },
    [plan.routes, planRouteIds, clearDetourGuidance]
  );

  const commitPersonalFork = useCallback(
    (forkId?: string) => {
      const offer = personalForkNav.offer;
      if (!offer) return;
      if (forkId && offer.fork.id !== forkId) return;
      const main =
        navPlannedMainGeometryRef.current ??
        personalForkMainGeometry ??
        guidanceRoute?.geometry ??
        null;
      if (!main || main.length < 2) return;

      const your = personalForkNav.buildCommitRoute(offer.fork, main, userAlongGuidanceM);
      setPlan((prev) => {
        const without = prev.routes.filter((r) => !isPersonalForkRouteId(r.id));
        return { ...prev, routes: [...without, your] };
      });
      setRouteSlotOrder((prev) => {
        const cleaned = prev.filter((id) => !isPersonalForkRouteId(id));
        return slotOrderAfterSelect(cleaned.length ? cleaned : [your.id], your.id);
      });
      setPreviewLegIndex(0);
      lockedNavigationRouteIdRef.current = PERSONAL_FORK_ROUTE_ID;
      onPersonalForkRef.current = true;
      adoptLockedRouteGeometry(your.geometry);
      personalForkNav.markCommitted(offer.fork.id);
      personalForkNav.noteAutoCommitAttempted(offer.fork.id);
      resetOffRouteNavigation();
      clearDetourGuidance();
      setViewMode("drive");
      setTapHint("Your route");
      window.setTimeout(() => setTapHint(null), 4000);
    },
    [
      personalForkNav,
      personalForkMainGeometry,
      guidanceRoute?.geometry,
      userAlongGuidanceM,
      adoptLockedRouteGeometry,
      resetOffRouteNavigation,
      clearDetourGuidance,
      setViewMode,
      setTapHint,
      setPlan,
      setRouteSlotOrder,
    ]
  );

  useEffect(() => {
    if (!personalForkNav.shouldAutoCommit || !personalForkNav.offer) return;
    personalForkNav.noteAutoCommitAttempted(personalForkNav.offer.fork.id);
    commitPersonalFork(personalForkNav.offer.fork.id);
  }, [personalForkNav.shouldAutoCommit, personalForkNav.offer, commitPersonalFork]);

  /** Route view / map view while navigating: preview A/B/C without changing active guidance. */
  const handlePreviewRouteSelect = useCallback(
    (id: string) => {
      if (!plan.routes.some((r) => r.id === id)) return;
      const i = orderedRouteIds.indexOf(id);
      if (i >= 0) setPreviewLegIndex(i);
      if (!navigationStarted || viewMode === "route" || viewMode === "topdown") {
        setFitTrigger((n) => n + 1);
      }
    },
    [plan.routes, orderedRouteIds, navigationStarted, viewMode]
  );

  const handleTollContinue = useCallback(() => {
    if (tollRoutePrompt) {
      tollAcceptedRouteIdsRef.current.add(tollRoutePrompt.routeId);
    }
    setTollAvoidFailureNote(null);
    setTollRoutePrompt(null);
    if (pendingGoAfterTollRef.current) {
      pendingGoAfterTollRef.current = false;
      proceedGo();
      return;
    }
    /* Sheet blocks chrome layout — refit Rt once the user accepts tolls (planning). */
    setViewMode("route");
    setFitTrigger((n) => n + 1);
  }, [tollRoutePrompt, proceedGo, setViewMode]);

  /* Toll preview kickoff lives in `useTollPreview` (Phase 4e4). The hook subscribes to
   * `routeCompareStore` + `tripPlanStore` internally; we just forward the App-owned bits
   * (busy / failure-note setters, env, location, the route-compare activation helper). */
  const handleTollPreview = useTollPreview({
    userLngLat,
    mapboxToken: env.mapboxToken,
    isPlus,
    stormAlertsForRouting,
    stormEnabled: settingStormEnabled,
    pendingGoAfterTollRef,
    setTollAvoidBusy,
    setTollAvoidFailureNote,
    activateRouteCompare,
  });

  useEffect(() => {
    if (!tollBypassEnabled) {
      setTollRoutePrompt(null);
      setTollAvoidFailureNote(null);
      pendingGoAfterTollRef.current = false;
      return;
    }
    if (navigationStarted || routing || plan.routes.length === 0 || trafficBypassCompare) return;
    const routeId =
      orderedRouteIds[previewLegIndex] ?? orderedRouteIds[0] ?? plan.routes[0]?.id;
    if (!routeId) return;
    const route = plan.routes.find((r) => r.id === routeId);
    if (!route?.hasTolls) {
      setTollRoutePrompt(null);
      return;
    }
    if (tollAcceptedRouteIdsRef.current.has(routeId)) {
      setTollRoutePrompt(null);
      return;
    }
    if (pendingGoAfterTollRef.current) return;
    setTollRoutePrompt({ routeId, labels: route.tollLabels ?? [] });
  }, [
    tollBypassEnabled,
    navigationStarted,
    routing,
    plan.routes,
    orderedRouteIds,
    previewLegIndex,
    trafficBypassCompare,
    setTollRoutePrompt,
  ]);

  /** Close hazard sheet + advisory panel, then run (helps WKWebView apply view/focus changes). */
  const runAfterHazardSheetAction = useCallback(
    (action: () => void) => {
      setRouteHazardSheet(null);
      onStormBarExpandedChange(false);
      window.requestAnimationFrame(() => {
        window.setTimeout(action, 0);
      });
    },
    [onStormBarExpandedChange]
  );

  const {
    handleTrafficBypassCompareSelect,
    handleTrafficBypassCompareCancel,
    handleTrafficBypassCompareConfirm,
    handleTrafficBypassFromHere,
    openDemoTrafficBypassCompareMock,
    hazardSheetAlternateAvailable,
    handleHazardSheetTryAlternate,
  } = useTrafficBypassFlow({
    isPlus,
    mapboxToken: env.mapboxToken,
    learnEnabled,
    settingStormEnabled,
    tollBypassEnabled,
    navigationStarted,
    demoBypassTrafficJamPlus,
    userLngLat,
    effectiveUserLngLat,
    destLngLat,
    destinationLabel,
    guidanceRoute,
    guidanceRouteId,
    userAlongGuidanceM,
    driveEtaMinutes,
    plan,
    scored,
    stormAlertsForRouting,
    routeImpactsForUi,
    trafficBypassContext,
    alternateBypassRouteId,
    routeHazardSheet,
    trafficBypassCompareRef,
    navigationStartedRef,
    routeGraphEpochRef,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setFitTrigger,
    setTapHint,
    setTollRoutePrompt,
    setTollAvoidFailureNote,
    setTrafficBypassCompare,
    setBypassBusy,
    activateRouteCompare,
    handlePromoteRouteToPrimary,
    onTrafficConfirmWhileNavigating: (geometry) => {
      navigationGuidanceGeometryRef.current = geometry;
      setGuidanceGeometryEpoch((n) => n + 1);
      setAlongHoldResetKey((n) => n + 1);
    },
    proceedGo,
    computeRoutes,
    runAfterHazardSheetAction,
  });


  const handleDriveCameraBearingDeg = useCallback((deg: number | null) => {
    setDriveMapBearingDeg((prev) => {
      if (deg == null) return null;
      if (prev != null && Math.abs(prev - deg) < 1.5) return prev;
      return deg;
    });
  }, []);

  const { handleQuickReportIssue, handleAdvisoryNwsClick } = useAdvisoryInteractions({
    env,
    viewMode,
    navigationStarted,
    destLngLat,
    lineFocusId,
    guidanceRoute,
    advisoryStormStripBands,
    setRouteHazardSheet,
  });

  /** Stop navigation and clear the trip (single “cancel everything” control). */
  /* handleStopAndClear comes from useTripLifecycle (Phase 3c). */

  const {
    recordedSuggestName,
    recordedEndLabel,
    recordedStartLabel,
    setRecordedEndLabel,
    setRecordedStartLabel,
    handleSaveCurrentDestination,
    handleSaveCurrentLocation,
    openSaveRouteSheet,
    handleLoadSavedRoute,
    handleReturnToPreviousDestination,
    handleStartRecordingPath,
    handleStopRecordingSave,
    handleDiscardRecordingPath,
  } = useSavedTripActions({
    destLngLat,
    destinationLabel,
    userLngLat,
    locationError,
    forecastPlaceShort,
    mapboxToken: env.mapboxToken,
    canAddPlace,
    canAddRoute,
    plan,
    lineFocusId,
    returnTripLeg,
    addPlace,
    resetNavigationPlanning,
    setPlan,
    setDestLngLat,
    setDestinationLabel,
    setSearchText,
    setSearchExpanded,
    setAllowAutocomplete,
    setRouteError,
    setSuggestions,
    setViewMode,
    setFitTrigger,
    setSavedDrawerOpen,
    setTapHint,
    setPendingSave,
    startRouteRecording,
    tryFinishRecording,
    discardRouteRecording,
  });

  useRecordedSaveLabels({
    pendingSave,
    mapboxToken: env.mapboxToken,
    setRecordedEndLabel,
    setRecordedStartLabel,
  });

  const handleInspectTrafficStop = useCallback(() => {
    const trafficAlert = routeAlerts.find(
      (a) =>
        a.corridorKind === "traffic" &&
        (a.id === "traffic-delay" || /stopped|closure|blocked|jam/i.test(`${a.title} ${a.detail}`))
    );
    if (trafficAlert) {
      setMapFocus({
        kind: "hazardOverview",
        hazardLng: trafficAlert.lngLat[0]!,
        hazardLat: trafficAlert.lngLat[1]!,
      });
      return;
    }
    if (guidanceRoute?.geometry?.length) {
      const tLeg = trafficOverlay?.[guidanceRouteId];
      const anchor = trafficCongestionAnchorFraction(tLeg ?? null);
      if (anchor == null) return;
      const p = pointAlongPolyline(guidanceRoute.geometry, anchor);
      if (p) {
        setMapFocus({
          kind: "hazardOverview",
          hazardLng: p[0],
          hazardLat: p[1],
        });
      }
    }
  }, [routeAlerts, guidanceRoute?.geometry, trafficOverlay, guidanceRouteId]);

  const advisoryRoadDetailRows = useMemo(
    () =>
      buildAdvisoryRoadDetailRows({
        guidanceRouteId,
        trafficOverlay,
        routeAlerts,
        onInspectTrafficStop: handleInspectTrafficStop,
      }),
    [guidanceRouteId, trafficOverlay, routeAlerts, handleInspectTrafficStop]
  );

  const activityBusyLabel = useDebouncedBusyLabel({
    routing,
    bypassBusy,
    suggestLoading,
    isPlus,
    navigationStarted,
    planRoutesLength: plan.routes.length,
    trafficFetchDone,
    settingTrafficEnabled,
    mapboxToken: env.mapboxToken,
    isOnline,
    stormLoading,
    advisoryLifeSafetyOn,
    stormCorridorAlertCount: stormCorridorAlerts.length,
    stormMapFeatureCount: stormMapGeoJson?.features?.length ?? 0,
  });

  /* Phase 3a/3b + peel: DriveMap + StormAdvisoryBar prop bags assembled together so App JSX
   * stays a thin spread. */
  const { driveMapProps, stormAdvisoryBarProps } = useAppMapChromeProps({
    driveMap: {
      routes: driveMapRoutesForMap,
      lineFocusId: driveMapLineFocusId,
      suggestedRouteId,
      userLngLat: effectiveUserLngLat,
      liveLngLatRef,
      liveSpeedMpsRef,
      liveHeadingRef,
      fitTrigger,
      heading,
      driveRouteBearingDeg,
      driveOffRouteForwardFraming,
      speedMps,
      allowDestinationPick,
      topdownZoomRef,
      onMapClick: handleMapClick,
      savedPlaces,
      savedPlacesVisible: showOnMap,
      onSavedPlaceClick: handleSavedMarkerClick,
      orderedRouteIds,
      radarMapOverlayOn,
      dataSaverMode,
      navMapLiteMode,
      onRadarFrameUtcSec: setRadarFrameUtcSec,
      alongRouteAlerts: mapAlongRouteAlertsForDrive,
      corridorRouteGeometry: guidanceRoute?.geometry,
      stormAlongRouteBands: mapStormAlongRouteBandsForDrive,
      recordingActive,
      recordingPathPreview,
      weatherAlertGeoJson: deferredNwsAlertGeoJsonForMap,
      stormBarVisible: showStormAdvisoryChrome,
      recenterPlanningPuckTick,
      navigationGuidanceGeometry,
      navPositionOnRoute: effectiveNavPosition.onRoute,
      userAlongGuidanceM,
      isPlus,
      hasMapboxToken: Boolean(env.mapboxToken),
      onDriveCameraBearingDeg: handleDriveCameraBearingDeg,
      lockedNavigationRouteId,
      activityTrailGeoJson: activityTrailGeoJsonForMap,
      guidanceRouteLengthM,
      maxPlanRouteLengthM,
      activityTrailPlanningBounds,
      idleHomeMapFraming,
      homePuckFollow,
      setHomePuckFollow,
      learnEnabled,
      homePreloadEnabled,
      homePreloadBounds,
      searchPickMarkers: searchPickMarkersForMap,
      onSearchPickMarkerClick: handleSearchPickFromMap,
      progressRailVisible: showProgressRail,
      offRouteRejoinCompareActive: offRouteHoldPreviewActive || detourAutoActive,
      followCamResyncKey,
    },
    stormAdvisoryBar: {
      isPlus,
      allDisplayableAlerts,
      nwsAlertsForGuidanceAdvisory,
      stormNwsPuckInside,
      trafficDelayMinutes: guidanceSlice?.trafficDelayMinutes ?? 0,
      trafficRerouteEligible: Boolean(
        TRAFFIC_BYPASS_ENABLED &&
          isPlus &&
          env.mapboxToken &&
          userLngLat &&
          destLngLat &&
          guidanceRoute &&
          showTrafficBypassCta
      ),
      onTrafficBypassFromHere: handleTrafficBypassFromHere,
      bypassBusy,
      hasGuidanceRoute: Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2),
      advisoryRoadDetailRows,
      advisoryRouteImpacts,
      advisoryStormStripBands,
      routeAheadTimeline,
      routeTotalMeters: guidanceRouteLengthM,
      userAlongMeters: advisoryUserAlongM,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes ?? null,
      driveEtaMinutes: driveEtaMinutes ?? null,
      onBarExpandedChange: onStormBarExpandedChange,
      onNwsAlertClick: handleAdvisoryNwsClick,
      busyLabel: activityBusyLabel,
      staleWeatherNote: routeForecastRefreshBlocked,
      onRefreshWeather: handleRefreshRouteInfoWeather,
      driveModeUi,
      driveRouteAheadLine,
      nextHazardAtEtaLine,
      advisoryPlusDetailOn,
      advisoryPromoLines,
      isOnline,
      advisoryNowcastLine,
      currentNowcast,
      forecastAreaLabel,
      tioMinutePrecip,
      localHourlyForecast,
      localDailyForecast,
      localForecastNwsAlerts,
      localForecastPanelLoading,
      weatherKitPrimary: env.weatherKitEnabled,
      forecastLngLat: userLngLat,
      onOpenAbout: () => setAboutOpen(true),
      basicStatusPanelPromos,
      showDataSaverHint,
      onDismissDataSaverHint: dismissDataSaverHintAction,
    },
  });

  return (
    <div
      className={buildAppShellClassName({
        navigationStarted,
        isDriveView: viewMode === "drive",
        isTopdownView: viewMode === "topdown",
        showProgressRail,
        trafficBypassCompareActive: Boolean(trafficBypassCompare),
        basemapNight,
        landscapeHandLeft: settingLandscapeSideHand === "left",
        radarFrameTimeVisible: radarMapOverlayOn && radarFrameUtcSec != null,
        basicAdBannerReservesSpace: basicAdBanner.reservesBottomSpace,
      })}
      style={buildDevPointerStyle()}
    >
      {import.meta.env.DEV ? (
        <div
          className="stormpath-build-stamp"
          title="Local Vite dev. Marketing / store version is not kept in sync here; bump package.json only when cutting a release."
          aria-label="Development mode"
        >
          Dev
        </div>
      ) : null}
      <AppMapStage driveMapProps={driveMapProps}>
        <div className="nav-drive-overlay-stack">
            {!trafficBypassCompare ? (
            <AppTopNavCluster
              navigationStarted={navigationStarted}
              hasPlanRoutes={plan.routes.length > 0}
              turnSteps={turnSteps}
              bannerTurnIndex={bannerTurnIndex}
              metersToBannerManeuver={metersToBannerManeuver}
              bannerInstructionOverride={bannerInstructionOverride}
              viewMode={viewMode}
              personalForkShowChip={personalForkNav.showChip}
              personalForkShowCommittedChip={personalForkNav.showCommittedChip}
              personalForkOffer={personalForkNav.offer}
              onTakePersonalFork={() => commitPersonalFork()}
              onDismissPersonalFork={() => personalForkNav.dismissForTrip()}
              showStormAdvisoryChrome={showStormAdvisoryChrome}
              stormAdvisoryBarProps={stormAdvisoryBarProps}
              isPlus={isPlus}
              activityBusyLabel={activityBusyLabel}
              radarMapOverlayOn={radarMapOverlayOn}
              radarFrameClockLabel={radarFrameClockLabel}
              hazardApproachAlertsActive={hazardApproachAlertsActive}
              driveApproachBannerPick={driveApproachBannerPick}
              showTrafficBypassCta={showTrafficBypassCta}
              bypassBusy={bypassBusy}
              setDemoApproachBannerOn={setDemoApproachBannerOn}
              setDemoCloseHazardOn={setDemoCloseHazardOn}
              setDriveApproachDismissedIds={setDriveApproachDismissedIds}
              openDemoTrafficBypassCompareMock={openDemoTrafficBypassCompareMock}
              handleTrafficBypassFromHere={handleTrafficBypassFromHere}
            />
            ) : null}
            {showProgressRail && (
              <AppProgressRail
                progressCalloutsOpen={progressCalloutsOpen}
                onProgressCalloutsOpenChange={setProgressCalloutsOpen}
                progressCalloutCount={progressCalloutCount}
                showRefresh={
                  isPlus &&
                  Boolean(
                    env.weatherKitEnabled ||
                      env.openWeatherApiKey ||
                      (routeWeatherReady &&
                        guidanceRoute?.geometry &&
                        guidanceRoute.geometry.length >= 2)
                  )
                }
                routeInfoWeatherRefreshing={routeInfoWeatherRefreshing}
                routeInfoRefreshNote={routeInfoRefreshNote}
                routeInfoRefreshNoteTone={routeInfoRefreshNoteTone}
                onRefreshRouteInfoWeather={handleRefreshRouteInfoWeather}
                routeAheadTimeline={routeAheadTimeline}
                routeWide={activeProgressCalloutPanel.routeWide}
                outlookSteps={activeProgressCalloutPanel.outlookTimeline}
                outlookSamples={activeProgressCalloutPanel.outlookSamples}
                radarMosaicSamples={radarMosaicSamples}
                radarRefreshBlocked={radarRefreshBlocked}
                radarMosaicUpdatedAt={radarMosaicUpdatedAt}
                windPoints={activeProgressCalloutPanel.windPoints}
                gustLinePoints={activeProgressCalloutPanel.gustLinePoints}
                gustSpikePoints={activeProgressCalloutPanel.gustSpikePoints}
                fallbackSegments={activeProgressCalloutPanel.segments.filter(
                  (s) => !s.key.startsWith("route-ahead-")
                )}
                guidanceRouteLengthM={guidanceRouteLengthM}
                progressPanelAlongM={progressPanelAlongM}
                planEtaMinutes={guidanceRoute?.baseEtaMinutes ?? null}
                driveEtaMinutes={driveEtaMinutes ?? null}
                progressCalloutUserAlongT={progressCalloutUserAlongT}
                stripTint={activeProgressCalloutPanel.stripTint}
                progressCalloutDetailScrollRef={progressCalloutDetailScrollRef}
                progressRailRouteGeometry={progressRailRoute!.geometry}
                effectiveUserLngLat={effectiveUserLngLat}
                userAlongGuidanceM={userAlongGuidanceM}
                progressStripAlerts={progressStripAlerts}
                radarIntensity={guidanceSlice?.radarIntensity ?? 0}
                progressStripRouteColor={progressStripRouteColor}
                progressRailRouteTurnSteps={progressRailRoute!.turnSteps}
                turnSteps={turnSteps}
                routeAheadProgressBands={routeAheadProgressBands}
                driveModeUi={driveModeUi}
                tripOdometerM={tripOdometerM}
                navigationStarted={navigationStarted}
              />
            )}
          </div>

        <AppHazardSheetsHost
          routeHazardSheet={routeHazardSheet}
          hazardSheetAlternateAvailable={hazardSheetAlternateAvailable}
          bypassBusy={bypassBusy}
          onCloseRouteHazardSheet={() => setRouteHazardSheet(null)}
          handleHazardSheetTryAlternate={handleHazardSheetTryAlternate}
          tollAvoidFailureNote={tollAvoidFailureNote}
          tollAvoidBusy={tollAvoidBusy}
          routing={routing}
          handleTollContinue={handleTollContinue}
          handleTollPreview={handleTollPreview}
        />

        <Suspense fallback={null}>
          <SavedDestinationsDrawer
          open={savedDrawerOpen}
          onClose={() => setSavedDrawerOpen(false)}
          maxSavedPlaces={savedPlacesMax}
          maxSavedRoutes={savedRoutesMax}
          canSavePlace={canAddPlace}
          canSaveRoute={canAddRoute}
          places={savedPlaces}
          showOnMap={showOnMap}
          onToggleShowOnMap={setShowOnMap}
          onGo={(lngLat, label) => handleSavedPlaceNavigate(lngLat, label)}
          onRename={updateName}
          onDelete={removePlace}
          onSaveCurrent={destLngLat ? handleSaveCurrentDestination : null}
          onSaveCurrentLocation={userLngLat ? () => void handleSaveCurrentLocation() : null}
          currentLocationLabel={forecastAreaLabel}
          currentDestLabel={destinationLabel || null}
          currentDestLngLat={destLngLat}
          savedRoutes={savedTripRoutes}
          onSaveCurrentRoute={
            plan.routes.some((r) => r.geometry.length >= 2) && destLngLat ? openSaveRouteSheet : null
          }
          onGoSavedRoute={handleLoadSavedRoute}
          onRenameSavedRoute={updateSavedTripRouteName}
          onDeleteSavedRoute={removeSavedTripRoute}
          onStartRecordingPath={userLngLat && !recordingActive ? handleStartRecordingPath : null}
          recordingActive={recordingActive}
          payFrequentRoutes={payFrequentRoutes}
          frequentRouteSuggestions={suggestedClusters}
          frequentRoutesLearnEnabled={learnEnabled}
          onFrequentRoutesLearnEnabled={setLearnEnabled}
          onTryFrequentRoute={(c) => handleLoadSavedRoute(learnedClusterToSavedRoute(c))}
          onSaveFrequentRoute={(c) => setPendingSave({ kind: "learned", cluster: c })}
          onDismissFrequentRoute={dismissCluster}
        />
        </Suspense>

        <PendingSaveSheets
          pendingSave={pendingSave}
          recordedSuggestName={recordedSuggestName}
          recordedStartLabel={recordedStartLabel}
          recordedEndLabel={recordedEndLabel}
          addSavedTripRoute={addSavedTripRoute}
          dismissCluster={dismissCluster}
          setPendingSave={setPendingSave}
          setTapHint={setTapHint}
        />

        <AppStatusBanners
          hasMapboxToken={Boolean(env.mapboxToken)}
          isNetlifyHost={
            typeof window !== "undefined" && window.location.hostname.includes("netlify.app")
          }
          devLocOverrideLngLat={devLocOverrideLngLat}
          locationFixSource={locationFixSource}
          locationError={locationError}
          routeError={routeError}
          tapHint={tapHint}
          safetyAck={safetyAck}
          onSafetyAck={() => setSafetyAck(true)}
          onReportIssue={
            env.supportEmail || env.supportUrl ? handleQuickReportIssue : null
          }
          isOnline={isOnline}
          navigationStarted={navigationStarted}
          hasPlanRoutes={plan.routes.length > 0}
          hasDest={Boolean(destLngLat)}
          driveModeUi={driveModeUi}
          isPlus={isPlus}
          demoBypassTrafficJamPlus={demoBypassTrafficJamPlus}
          demoPlaybackPlaying={demoPlaybackPlaying}
          demoApproachBannerOn={demoApproachBannerOn}
          demoCloseHazardOn={demoCloseHazardOn}
          trafficBypassCompareOpen={Boolean(trafficBypassCompare)}
          onToggleDemoPlayback={toggleDemoPlaybackPlaying}
          onResetDemoPlayback={resetDemoPlaybackAlongRoute}
          onToggleDemoApproachBanner={() => {
            setDemoApproachBannerOn((v) => !v);
            if (demoCloseHazardOn) setDemoCloseHazardOn(false);
          }}
          onToggleDemoCloseHazard={() => {
            setDemoCloseHazardOn((v) => !v);
            if (demoApproachBannerOn) setDemoApproachBannerOn(false);
          }}
          onOpenDemoCompare={openDemoTrafficBypassCompareMock}
        />

        <AppBottomChrome
          handleTrafficBypassCompareSelect={handleTrafficBypassCompareSelect}
          handleTrafficBypassCompareConfirm={handleTrafficBypassCompareConfirm}
          handleTrafficBypassCompareCancel={handleTrafficBypassCompareCancel}
          recordingActive={recordingActive}
          trafficBypassCompareActive={Boolean(trafficBypassCompare)}
          recordingPointCount={recordingPointCount}
          recordingLengthM={recordingLengthM}
          handleStopRecordingSave={handleStopRecordingSave}
          handleDiscardRecordingPath={handleDiscardRecordingPath}
          navigationStarted={navigationStarted}
          viewMode={viewMode}
          driveMapBearingDeg={driveMapBearingDeg}
          onOpenAbout={() => setAboutOpen(true)}
          driveDistanceRemainingLabel={driveDistanceRemainingLabel}
          routePickItems={routePickItems}
          lineFocusId={lineFocusId}
          planRouteIds={planRouteIds}
          previewLegIndex={previewLegIndex}
          handlePreviewRouteSelect={handlePreviewRouteSelect}
          routeDockDetail={routeDockDetail}
          radarMapOverlayOn={radarMapOverlayOn}
          radarFrameTimeLabel={radarFrameTimeLabel}
          planRoutesLength={plan.routes.length}
          userLngLat={userLngLat}
          onRecenterPlanningPuck={() => {
            setHomePuckFollow("follow");
            setRecenterPlanningPuckTick((n) => n + 1);
          }}
          showCompactDest={showCompactDest}
          handleCompactDestOpen={handleCompactDestOpen}
          destinationLabel={destinationLabel}
          searchText={searchText}
          onSearchTextChange={(v) => {
            setSearchText(v);
            if (plan.routes.length === 0 || searchExpanded) setAllowAutocomplete(true);
          }}
          handleSearchFieldBeginEditing={handleSearchFieldBeginEditing}
          handleSearchFieldEndEditing={handleSearchFieldEndEditing}
          handleSearchCancelSuggestions={handleSearchCancelSuggestions}
          handleSearchDismiss={handleSearchDismiss}
          onSearchSubmit={() => void handleSearch()}
          searchPlaceholder={
            addingViaStop && destLngLat ? "Search your stop" : "Search address or place"
          }
          suggestions={suggestions}
          onPickSuggestion={(h) => void handlePickSuggestion(h)}
          suggestLoading={suggestLoading}
          enableSuggestions={allowAutocomplete && (!routeActive || searchExpanded)}
          viaStops={viaStops}
          addingViaStop={addingViaStop}
          canAddStop={Boolean(destLngLat)}
          onStartAddStop={() => setAddingViaStop(true)}
          onCancelAddStop={() => setAddingViaStop(false)}
          handleRemoveViaStop={handleRemoveViaStop}
          handleViewModeChange={handleViewModeChange}
          onOpenSaved={() => setSavedDrawerOpen(true)}
          handleGo={handleGo}
          showGo={Boolean(plan.routes.length > 0 && primaryRouteId && !navigationStarted)}
          speedMph={speedMph}
          postedMph={postedMph}
          handleStopAndClear={handleStopAndClear}
          hasTrip={Boolean(plan.routes.length > 0 || destLngLat)}
          showReturnTripButton={showReturnTripButton}
          returnTripButtonLabel={returnTripButtonLabel}
          returnTripTitle={
            returnTripLeg
              ? `Return to ${returnTripLeg.returnToLabel} on your previous route (reversed)`
              : undefined
          }
          handleReturnToPreviousDestination={handleReturnToPreviousDestination}
          showSavedPlacesButton={mapPlanningUi && (!navigationStarted || !routeActive)}
          driveEtaMinutes={driveEtaMinutes}
          onToggleRadar={() => setShowRadar((v) => !v)}
          settingRadarEnabled={settingRadarEnabled}
          driveModeUi={driveModeUi}
          showOffRouteStatusBanner={showOffRouteStatusBanner}
          detourAutoActive={detourAutoActive}
          detourRejoinDistanceLabel={detourRejoinDistanceLabel}
          routing={routing}
          onStayOnThisRoad={() => void stayOnThisRoad()}
          returnToOriginalRoute={returnToOriginalRoute}
          showTrafficBypassCta={showTrafficBypassCta}
          bypassBusy={bypassBusy}
          onTrafficBypassFromHere={() => void handleTrafficBypassFromHere()}
        />
      </AppMapStage>

      <AppAboutSheetHost
        payTierProbeKey={payTierProbeKey}
        reprobePayTier={reprobePayTier}
        activityTrailAboutPanel={activityTrailAboutPanel}
        homePuckFollow={homePuckFollow}
        onHomePuckFollowChange={(mode) => {
          setHomePuckFollow(mode);
          writeHomePuckFollow(mode);
          if (mode === "follow") setRecenterPlanningPuckTick((n) => n + 1);
        }}
        tierLabel={tierLabel}
        onReplayCoachmarks={handleReplayCoachmarks}
        setTapHint={setTapHint}
      />

      <Coachmarks replayKey={coachmarksReplayKey} />
    </div>
  );
}
