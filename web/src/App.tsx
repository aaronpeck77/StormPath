import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { getWebEnv } from "./config/env";
import { DEV_CURSOR_DEFAULT, DEV_CURSOR_POINTER } from "./dev/devCursor";
import { useFusedSituation } from "./hooks/useFusedSituation";
import { useSavedPlaces } from "./hooks/useSavedPlaces";
import { useSavedRoutes } from "./hooks/useSavedRoutes";
import { useRouteRecorder } from "./hooks/useRouteRecorder";
import { useProgressRailFootInset } from "./hooks/useProgressRailFootInset";
import { useSessionOdometerMeters } from "./hooks/useSessionOdometerMeters";
import {
  useUserLocation,
  getDevLocationOverrideLngLat,
  clearDevLocationOverride,
  GPS_STATE_THROTTLE_MS_NORMAL,
  GPS_STATE_THROTTLE_MS_ULTRA_LONG,
} from "./hooks/useUserLocation";
import { useDestinationSearch } from "./hooks/useDestinationSearch";
import { useNavigationPosition } from "./hooks/useNavigationPosition";
import { useOpenWeatherNowcast } from "./hooks/useOpenWeatherNowcast";
import { useTrafficOverlayFetch } from "./hooks/useTrafficOverlayFetch";
import { useWeatherOverlayFetch } from "./hooks/useWeatherOverlayFetch";
import { useRadarBandsAlongRoute } from "./hooks/useRadarBandsAlongRoute";
import {
  useLocalHourlyForecast,
  useTomorrowMinutePrecip,
  useTomorrowRouteForecast,
} from "./hooks/useTomorrowWeather";
import { buildMockTripBetween, EMPTY_TRIP } from "./nav/emptyTrip";
import { mergePlanPreservingPrimary } from "./nav/mergePlanRoutes";
import {
  navigationPrimaryRouteIdForMerge,
  resolveNavigationRouteIds,
} from "./nav/navigationRouteFocus";
import { tripPlanFromSavedRoute } from "./nav/planFromSavedRoute";
import {
  isGenericOriginLabel,
  loadReturnTripLeg,
  persistReturnTripLegOnGo,
  shortenReturnTripLabel,
  type ReturnTripLeg,
} from "./nav/returnTripLeg";
import type { SavedRoute } from "./nav/savedRoutes";
import type { LngLat } from "./nav/types";
import { pickSuggestedActive, scoreTrip } from "./scoring/scoreRoutes";
import { collectMapboxRouteVariants } from "./services/mapboxDirectionsRouter";
import { useAppForeground } from "./hooks/useAppForeground";
import { formatDistanceShort, useMilesForLngLat } from "./utils/formatDistance";
import { useTollPreview } from "./nav/useTollPreview";
import {
  getNwsPollIntervalMs,
  getRadarRouteSampleIntervalMs,
  isDataSaverMode,
  isLongTripRoute,
  isNavMapLiteMode,
  isUltraLongTripRoute,
  quantizeRouteAlongForHeavyUi,
} from "./utils/dataSaver";
import {
  formatCoordsAreaLabel,
  shortenPlaceNameForForecast,
} from "./utils/forecastDisplay";
import { mapboxReverseGeocode } from "./services/mapboxGeocode";
import {
  trafficCongestionAnchorFraction,
} from "./services/mapboxDirectionsTraffic";
import {
  formatNowcastLine,
} from "./services/openWeatherClient";
import { formatMinutePrecipNowLine } from "./utils/forecastDisplay";
import { type RouteImpact } from "./nav/routeImpacts";
import { type RouteAlert, routeAlertShowsOnRouteLine } from "./nav/routeAlerts";
import {
  timelineToMapCorridorAlerts,
} from "./nav/routeAheadSync";
import {
  bearingAlongRouteAhead,
  closestAlongRouteMeters,
  haversineMeters,
  initialBearingDegrees,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./nav/routeGeometry";
import {
  computeRemainingDistanceMeters,
  computeRemainingDriveEtaMinutes,
} from "./nav/tripNavDisplay";
import { useTripNavDisplayHealth } from "./nav/useTripNavDisplayHealth";
import { useRouteAheadDerivations } from "./nav/useRouteAheadDerivations";
import { useProgressCalloutPanel } from "./nav/useProgressCalloutPanel";
import { useNavAlternateRouteRefresh } from "./nav/useNavAlternateRouteRefresh";
import { formatRouteDistanceMi, routeConsiderationSummary } from "./nav/routeSummary";
import { buildDriveRouteAheadFromImpacts } from "./nav/driveRouteAhead";
import { pickDriveApproachBanner } from "./nav/driveHazardApproachPreview";
import { pickTrafficBypassAnchorImpact } from "./nav/trafficBypassOffer";
import { trafficBypassOfferHeadline, withTrafficBypassCompareKind } from "./nav/trafficBypassFlow";
import { earlyApproachMaxMetersForSpeed } from "./nav/surgicalBypassWindow";
import { unifiedTrafficNarrative, hasLocalizedTrafficIssue } from "./nav/trafficNarrative";
import {
  DRIVE_AHEAD_WINDOW_M,
  TRAFFIC_BYPASS_ENABLED,
} from "./nav/constants";
import { routeForecastIntensityFloor, worstCorridorInterval } from "./forecast/corridorForecastModel";
import type { TrafficOverlay, WeatherOverlay } from "./situation/fusedSnapshot";
import type { MapViewMode } from "./ui/driveMapTypes";
import { stormpathVersionLabel } from "./appVersion";
import {
  applyLayerStartupMigrations,
  readNwsSessionOn,
  readRadarOverlayOn,
  readRoadAdvisoryDetailOn,
  writeNwsSessionOn,
  writeRadarOverlayOn,
  writeRoadAdvisoryDetailOn,
} from "./layerStartupPrefs";

/** Prod code-split. Normalizes named/default export so React.lazy never hits its broken `%s` log path. */
const lazyDriveMap = () =>
  import("./ui/DriveMap").then((m) => {
    const component = m.default ?? m.DriveMap;
    if (component == null) {
      throw new Error("DriveMap failed to load (missing component export). Hard-reload the page.");
    }
    return { default: component };
  });

const DriveMap = lazy(lazyDriveMap);

if (import.meta.hot) {
  /* React.lazy caches the first import — after DriveMap HMR, reload so lazy picks up the new module. */
  import.meta.hot.accept("./ui/DriveMap", () => {
    window.location.reload();
  });
}
const AboutSheet = lazy(() => import("./ui/AboutSheet").then((m) => ({ default: m.AboutSheet })));
const SavedDestinationsDrawer = lazy(() =>
  import("./ui/SavedDestinationsDrawer").then((m) => ({ default: m.SavedDestinationsDrawer }))
);
import { SearchBar } from "./ui/SearchBar";
import type { SearchSuggestion } from "./ui/SearchBar";
import { isNarrowPhoneViewport } from "./ui/mapFitLogic";
import { BottomToolbar } from "./ui/BottomToolbar";
import { NavMilesLeftBox } from "./ui/NavMilesLeftBox";
import { DriveCompass } from "./ui/DriveCompass";
import { RouteCycleButton, type RoutePickItem } from "./ui/RoutePickBar";
import { RouteStopsBar } from "./ui/RouteStopsBar";
import {
  currentNavTarget,
} from "./nav/routeWaypoints";
import { routePickSlotHex } from "./ui/mapRouteStyle";
import { routeSlotIndexFor } from "./ui/mapRouteLayers";
import {
  isFullSlotPermutation,
  reconcileSlotOrderWithPlan,
  slotOrderAfterSelect,
} from "./nav/routeSlotOrder";
import { NameConfirmSheet } from "./ui/NameConfirmSheet";
import { TopGuidanceBar } from "./ui/TopGuidanceBar";
import { RecordingRouteBanner } from "./ui/RecordingRouteBanner";
import { RouteHazardSheet } from "./ui/RouteHazardSheet";
import { TollFlowSheets } from "./ui/TollFlowSheets";
import { RouteProgressStrip } from "./ui/RouteProgressStrip";
import { RouteProgressGlancePanel } from "./ui/RouteProgressGlancePanel";
import { RouteProgressCalloutRail } from "./ui/RouteProgressCalloutRail";
import { formatEtaDuration } from "./ui/formatEta";
import { StormAdvisoryBar } from "./ui/StormAdvisoryBar";
import { DriveHazardApproachBanner } from "./ui/DriveHazardApproachBanner";
import { ActivityStatusPill } from "./ui/ActivityStatusPill";
import { Coachmarks } from "./ui/Coachmarks";
import { resetAllCoachmarks } from "./ui/coachmarks/firstLaunchSteps";
import { RouteCompareBottomPanel } from "./ui/RouteCompareBottomPanel";
import { pointAlongPolyline } from "./ui/geometryAlong";
import { mapGeoJsonFromAlerts } from "./weatherAlerts/mapGeoJsonFromAlerts";
import { routeAlertForNwsAdvisoryClick } from "./weatherAlerts/nwsAsRouteAlerts";
import type { NormalizedWeatherAlert } from "./weatherAlerts/types";
import {
  buildAdvisoryPromoLines,
  buildBasicNavAdvisoryPromoLines,
  buildBasicNavStatusPanelPromos,
} from "./config/basicAds";
import { payTierTestPanelEnabled } from "./config/env";
import { useBasicAdMobBanner } from "./hooks/useBasicAdMobBanner";
import { getPayTier, hasTollBypass, maxSavedPlaces, maxSavedRoutes } from "./billing/payFeatures";
import { NATIVE_PAY_TIER_CHANGED_EVENT, refreshPlusEntitlementFromStore, whenRevenueCatReady } from "./billing/revenueCat";
import { learnedClusterToSavedRoute } from "./frequentRoutes/learnedToSaved";
import { completedTripFromGeometry } from "./frequentRoutes/tripDetector";
import { useFrequentRouteLearning } from "./hooks/useFrequentRouteLearning";
import { isMapBasemapDaytime } from "./map/mapBasemapDaytime";
import {
  readHomeMapFraming,
  writeHomeMapFraming,
  type HomeMapFraming,
} from "./map/homeMapFraming";
import {
  readHomePuckFollow,
  writeHomePuckFollow,
  type HomePuckFollowMode,
} from "./map/homePuckFollow";
import {
  estimatePreloadStorageLabel,
  getHomePreloadBounds,
  readHomePreloadEnabled,
  writeHomePreloadEnabled,
  clearHomePreloadRecord,
} from "./map/homePreloadRegion";
import {
  ACTIVITY_MIN_SAMPLES_PLANNING_MAP,
  ACTIVITY_MIN_SAMPLES_RANK,
  ACTIVITY_SAMPLES_UPDATED_EVENT,
  activitySamplesToGeoJson,
  clearActivitySamples,
  getActivityTrailPlanningBounds,
  getActivityTrailStats,
  loadActivitySamples,
  rankSearchSuggestionsByTrailCentroid,
} from "./frequentRoutes/activitySamples";
import { BYPASS_HEAVY_DELAY_MINUTES } from "./nav/constants";
import {
  clearActiveTripCache,
  loadActiveTripFromCache,
  MAX_TRIP_CACHE_AGE_MS,
  saveActiveTripToCache,
  isRestorableActiveTripEntry,
} from "./tripCache";
import {
  getTollCompareContext,
  setTollCompareContext,
  type TrafficBypassCompareState,
  useRouteCompareStore,
} from "./state/routeCompareStore";
import { useComputeRoutes } from "./nav/useComputeRoutes";
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
import {
  getViewModeBeforeTrafficBypass,
  setViewModeBeforeTrafficBypass,
  useUiStore,
} from "./state/uiStore";
import { useWeatherStore } from "./state/weatherStore";
import { safeStorage } from "./storage/safeStorage";
import {
  areaKeyFromLngLat,
  areaLabelFromDestinationLabel,
  loadPreferredAreaRouteMap,
  savePreferredAreaRouteMap,
  type PreferredAreaRouteMap,
} from "./preferredAreaRoutes";
import "./App.css";

/* `PendingSave` lives in `state/uiStore.ts` (Phase 4e5a). The type is exported from there
 * for future consumers; App.tsx no longer references it directly because the `useState<…>`
 * annotation moved into the store. */

/* `TrafficBypassCompareState` lives in `state/routeCompareStore.ts` (Phase 4c) and is imported
 * at the top of this file. The shape is unchanged — it just lives next to the store that owns
 * it so the panel and store can never drift. */

/** Pre-select the active leg when opening A/B/C compare so Go works without an extra tap. */
function defaultRouteCompareSelection(guidanceRouteId: string): "r-a" | "r-b" | "r-c" {
  if (guidanceRouteId === "r-a" || guidanceRouteId === "r-b" || guidanceRouteId === "r-c") {
    return guidanceRouteId;
  }
  return "r-a";
}

/** Cancel route compare — flat map view, not tilted drive camera. */
function viewModeAfterCompareCancel(
  restore: MapViewMode | null | undefined,
  navigationStarted: boolean
): MapViewMode {
  if (navigationStarted && restore === "drive") return "topdown";
  if (restore) return restore;
  return navigationStarted ? "topdown" : "route";
}

/** Route mode: refresh B/C alternates only (primary leg unchanged). */
/** Best-effort cap for IndexedDB writes while still capturing route refreshes. */
const TRIP_CACHE_MIN_SAVE_INTERVAL_MS = 20_000;

export default function App() {
  applyLayerStartupMigrations();
  const env = useMemo(() => getWebEnv(), []);
  /** Demo tools (mock banner, mock close hazard, mock compare) are dev-only. The `?demo=bypass`
   *  URL flag still has to be present, but we additionally hard-gate on `import.meta.env.DEV` so
   *  TestFlight / production builds can never surface the demo strip even if the flag leaks in. */
  const demoBypassTrafficJam = useMemo(() => {
    if (!import.meta.env.DEV) return false;
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).get("demo") === "bypass";
    } catch {
      return false;
    }
  }, []);
  /** Bumped when dev About changes `PAY_TIER_OVERRIDE_LS_KEY` or RevenueCat entitlement updates. */
  const [payTierProbeKey, setPayTierProbeKey] = useState(0);
  const reprobePayTier = useCallback(() => setPayTierProbeKey((n) => n + 1), []);
  useEffect(() => {
    const handler = () => reprobePayTier();
    window.addEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
    /* Re-read tier after async RevenueCat init may have written entitlement before listener mounted. */
    queueMicrotask(reprobePayTier);
    return () => window.removeEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
  }, [reprobePayTier]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    void whenRevenueCatReady().then(async (ready) => {
      if (cancelled || !ready) return;
      const outcome = await refreshPlusEntitlementFromStore();
      if (!cancelled) reprobePayTier();
      if (import.meta.env.DEV && outcome.status === "error") {
        console.warn("[RevenueCat] launch entitlement sync:", outcome.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reprobePayTier]);
  /** Plus vs Basic from `getPayTier()` (build env + native entitlement + optional LS override). */
  const isPlus = useMemo(() => getPayTier() === "plus", [payTierProbeKey]);
  const savedPlacesMax = useMemo(() => maxSavedPlaces(), [payTierProbeKey]);
  const savedRoutesMax = useMemo(() => maxSavedRoutes(), [payTierProbeKey]);
  const tollBypassEnabled = useMemo(() => hasTollBypass(), [payTierProbeKey]);
  const advisoryPromoLines = useMemo(
    () => (isPlus ? buildAdvisoryPromoLines(env, isPlus) : buildBasicNavAdvisoryPromoLines(env)),
    [env, isPlus]
  );
  const basicStatusPanelPromos = useMemo(
    () => (isPlus ? null : buildBasicNavStatusPanelPromos(env)),
    [env, isPlus]
  );
  /** `?demo=bypass` replay / simulated delay — Plus only (matches Traffic bypass). */
  const demoBypassTrafficJamPlus = demoBypassTrafficJam && isPlus;
  const demoBypassTrafficJamPlusRef = useRef(false);
  demoBypassTrafficJamPlusRef.current = demoBypassTrafficJamPlus;
  const payFrequentRoutes = isPlus;
  const tierLabel = isPlus ? "Plus" : "Basic";
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
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
  const applySettings = useSettingsStore((s) => s.applySettings);
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
  } = useFrequentRouteLearning({
    payUnlocked: payFrequentRoutes,
    userLngLat,
    speedMps,
  });

  const navGoStartedAtRef = useRef<number | null>(null);
  const navGoGeometryRef = useRef<LngLat[] | null>(null);
  /** Full step geometry for guidance math — separate from display-tier plan state. */
  const navigationGuidanceGeometryRef = useRef<LngLat[] | null>(null);
  const [guidanceGeometryEpoch, setGuidanceGeometryEpoch] = useState(0);
  const [alongHoldResetKey, setAlongHoldResetKey] = useState(0);
  /** Route id locked at Go — guidance follows this until the driver explicitly switches legs. */
  const lockedNavigationRouteIdRef = useRef<string | null>(null);

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

  const [recordedSuggestName, setRecordedSuggestName] = useState("");
  const [recordedEndLabel, setRecordedEndLabel] = useState("Recorded destination");
  const [recordedStartLabel, setRecordedStartLabel] = useState("Start of path");

  const [stormSessionOn, setStormSessionOn] = useState(readNwsSessionOn);

  /** Never persisted — each route session starts closed; cleared when the plan changes or the trip is stopped. */
  const progressCalloutsOpen = useUiStore((s) => s.progressCalloutsOpen);
  const setProgressCalloutsOpen = useUiStore((s) => s.setProgressCalloutsOpen);
  const progressCalloutDetailScrollRef = useRef<HTMLDivElement | null>(null);

  /** Road & traffic overlay (Hazards strip + map traffic colors). Default on until user turns off. */
  const [roadAdvisoryDetailOn, setRoadAdvisoryDetailOn] = useState(readRoadAdvisoryDetailOn);

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
  const stormError = useWeatherStore((s) => s.stormError);
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
  const setViaStops = useTripPlanStore((s) => s.setViaStops);
  const activeViaIndex = useTripPlanStore((s) => s.activeViaIndex);
  const setActiveViaIndex = useTripPlanStore((s) => s.setActiveViaIndex);
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
  const [weatherOverlay, setWeatherOverlay] = useState<WeatherOverlay | undefined>(
    undefined
  );
  const navigationStarted = useTripPlanStore((s) => s.navigationStarted);
  const setNavigationStarted = useTripPlanStore((s) => s.setNavigationStarted);
  const navigationStartedRef = useRef(navigationStarted);
  navigationStartedRef.current = navigationStarted;
  const userAlongGuidanceMRef = useRef(0);
  const guidanceRouteGeomRef = useRef<LngLat[] | null>(null);
  const guidanceRouteLengthMRef = useRef(0);

  /** Keep the screen on while navigating on device; allow sleep when done. */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (navigationStarted) {
      void KeepAwake.keepAwake();
    } else {
      void KeepAwake.allowSleep();
    }
  }, [navigationStarted]);

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

  const driveModeUi = navigationStarted && viewMode === "drive";
  /** Third-party AdMob only — house promos (SiteBible, Plus upsell) live in StormAdvisoryBar. */
  const basicAdBanner = useBasicAdMobBanner({
    enabled: !isPlus,
    navigationStarted,
    payTierProbeKey,
  });
  /** NWS polygons + fetches follow the user’s NWS toggle everywhere (including drive — no auto-on). */
  const savedDrawerOpen = useUiStore((s) => s.savedDrawerOpen);
  const setSavedDrawerOpen = useUiStore((s) => s.setSavedDrawerOpen);
  const [bypassBusy, setBypassBusy] = useState(false);
  /* Compare panel state lives in `useRouteCompareStore` (Phase 4c). Local names + setter
   * signature preserved so the ~30 reads / setters in this file are unchanged. */
  const trafficBypassCompare = useRouteCompareStore((s) => s.trafficBypassCompare);
  const setTrafficBypassCompare = useRouteCompareStore((s) => s.setTrafficBypassCompare);
  const trafficBypassCompareRef = useRef<TrafficBypassCompareState | null>(null);
  trafficBypassCompareRef.current = trafficBypassCompare;
  const [driveApproachDismissedIds, setDriveApproachDismissedIds] = useState(() => new Set<string>());
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
  const demoPlaybackAlongRef = useRef<number | null>(null);
  demoPlaybackAlongRef.current = demoPlaybackAlongM;
  /** At destination, stationary + no interaction → clearRoute; foreground timer + resume-from-background. */
  const [trafficOverlay, setTrafficOverlay] = useState<TrafficOverlay | undefined>(undefined);
  const [trafficFetchDone, setTrafficFetchDone] = useState(true);
  const mapFocus = useUiStore((s) => s.mapFocus);
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
  /** Map overlay (toolbar Rad). Default ON — weather-first app design. */
  const [showRadar, setShowRadar] = useState(readRadarOverlayOn);
  useEffect(() => {
    writeRadarOverlayOn(showRadar);
  }, [showRadar]);
  /** Radar visible in all modes except drive (too distracting at street level). Paused when app is backgrounded. */
  const radarMapOverlayOn = showRadar && !driveModeUi && appForeground;
  const [radarFrameUtcSec, setRadarFrameUtcSec] = useState<number | null>(null);
  const seriousHazardAutoFlewRef = useRef<Set<string>>(new Set());
  const [safetyAck, setSafetyAck] = useState(() => {
    return safeStorage.get("stormpath-safety-ack-v1") === "1";
  });
  const routeSlotOrder = useTripPlanStore((s) => s.routeSlotOrder);
  const setRouteSlotOrder = useTripPlanStore((s) => s.setRouteSlotOrder);
  const previewLegIndex = useTripPlanStore((s) => s.previewLegIndex);
  const setPreviewLegIndex = useTripPlanStore((s) => s.setPreviewLegIndex);

  /** Matches Mapbox night basemap window — stronger chrome borders when the basemap is night. */
  const [basemapNight, setBasemapNight] = useState(() => !isMapBasemapDaytime());
  useEffect(() => {
    const sync = () => setBasemapNight(!isMapBasemapDaytime());
    sync();
    const id = window.setInterval(sync, 60_000);
    return () => window.clearInterval(id);
  }, []);

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

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

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

  useEffect(() => {
    if (!pendingSave || pendingSave.kind !== "recorded") return;
    setRecordedEndLabel("Recorded destination");
    setRecordedStartLabel("Start of path");
    if (!env.mapboxToken) return;
    const [lng, lat] = pendingSave.destinationLngLat;
    const start = pendingSave.geometry[0];
    let cancelled = false;
    void mapboxReverseGeocode(lng, lat, env.mapboxToken).then((rev) => {
      if (!cancelled && rev?.placeName) setRecordedEndLabel(rev.placeName);
    });
    if (start) {
      void mapboxReverseGeocode(start[0]!, start[1]!, env.mapboxToken).then((rev) => {
        if (!cancelled && rev?.placeName) setRecordedStartLabel(rev.placeName);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [pendingSave, env.mapboxToken]);

  const planRef = useRef(plan);
  planRef.current = plan;
  const guidanceRouteIdRef = useRef("");
  const navRouteLengthMRef = useRef(0);
  const planRoutesKeyStable = useMemo(() => plan.routes.map((r) => r.id).join("|"), [plan.routes]);

  const currentNowcast = useOpenWeatherNowcast({
    isPlus,
    isOnline,
    openWeatherApiKey: env.openWeatherApiKey,
    weatherKitEnabled: env.weatherKitEnabled,
    userLngLat,
    userLngLatRef,
  });
  const [forecastPlaceShort, setForecastPlaceShort] = useState<string | null>(null);

  const { bumpTrafficRefresh } = useTrafficOverlayFetch({
    planRef,
    guidanceRouteIdRef,
    routingRef,
    navRouteLengthMRef,
    planRoutesKeyStable,
    navigationStarted,
    isPlus,
    isOnline,
    settingTrafficEnabled,
    mapboxToken: env.mapboxToken,
    dataSaverMode,
    appForeground,
    setTrafficOverlay,
    setTrafficFetchDone,
  });

  const snap = useFusedSituation(plan, weatherOverlay, trafficOverlay);
  const scored = useMemo(() => scoreTrip(plan, snap, "balanced"), [plan, snap]);

  const primaryRouteId = plan.routes[0]?.id ?? "";
  const planRoutesKey = useMemo(() => plan.routes.map((r) => r.id).join("|"), [plan.routes]);
  const planRouteIds = useMemo(() => plan.routes.map((r) => r.id), [plan.routes]);
  const routeSlotOrderKey = useMemo(() => routeSlotOrder.join("|"), [routeSlotOrder]);

  const lastTripCacheSaveMsRef = useRef(0);

  /** One-shot restore after reload / cold start — must run before relying on network for the same trip. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entry = await loadActiveTripFromCache();
      if (cancelled || !entry) return;
      if (!isRestorableActiveTripEntry(entry)) {
        void clearActiveTripCache();
        return;
      }
      const ageMs = Date.now() - entry.savedAtMs;
      if (!Number.isFinite(ageMs) || ageMs > MAX_TRIP_CACHE_AGE_MS || ageMs < -60_000) {
        void clearActiveTripCache();
        return;
      }
      let planNext = entry.plan;
      if (!isPlus && planNext.routes.length > 2) {
        planNext = { ...planNext, routes: planNext.routes.slice(0, 2) };
      }
      const planIds = planNext.routes.map((r) => r.id);
      const slotNext = isFullSlotPermutation(entry.routeSlotOrder, planIds)
        ? entry.routeSlotOrder
        : reconcileSlotOrderWithPlan(entry.routeSlotOrder, planIds);
      const nRoutes = planNext.routes.length;
      const previewNext =
        nRoutes > 0 ? Math.min(Math.max(0, entry.previewLegIndex), nRoutes - 1) : 0;
      let viewNext = entry.viewMode;
      if (!entry.navigationStarted && viewNext === "drive") {
        viewNext = "route";
      }
      setPlan(planNext);
      setDestLngLat(entry.destLngLat);
      setDestinationLabel(entry.destinationLabel);
      setSearchText(entry.destinationLabel);
      setNavigationStarted(entry.navigationStarted);
      if (entry.navigationStarted) {
        lockedNavigationRouteIdRef.current = slotNext[0] ?? planIds[0] ?? null;
      }
      setViewMode(viewNext);
      setRouteSlotOrder(slotNext);
      setPreviewLegIndex(previewNext);
      setSearchExpanded(false);
      setAllowAutocomplete(false);
      setRouteError(null);
      setSuggestLoading(false);
      setSuggestions([]);
      setFitTrigger((n) => n + 1);
      lastTripCacheSaveMsRef.current = Date.now();
    })();
    return () => {
      cancelled = true;
    };
    /* Restore once at boot; `isPlus` is intentionally first-paint only so tier overrides mid-session do not replay cache. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const targetCount = isPlus ? 3 : 2;
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

  // Persist the active trip so navigation can keep working after the network drops.
  useEffect(() => {
    if (!destLngLat) return;
    if (!plan.routes.length) return;
    if (!destinationLabel.trim()) return;
    if (!fitTrigger) return;

    const now = Date.now();
    if (now - lastTripCacheSaveMsRef.current < TRIP_CACHE_MIN_SAVE_INTERVAL_MS) return;
    lastTripCacheSaveMsRef.current = now;

    const entry: Parameters<typeof saveActiveTripToCache>[0] = {
      version: 1,
      savedAtMs: now,
      destLngLat,
      destinationLabel: destinationLabel.trim(),
      navigationStarted,
      viewMode,
      routeSlotOrder,
      previewLegIndex,
      plan,
    };
    /* Defer IndexedDB + structured-clone so the first paint after routing isn’t contending on the main thread. */
    const schedule =
      typeof requestIdleCallback !== "undefined"
        ? (cb: () => void) => {
            const id = requestIdleCallback(() => cb(), { timeout: 4_000 });
            return () => cancelIdleCallback(id);
          }
        : (cb: () => void) => {
            const t = window.setTimeout(cb, 0);
            return () => clearTimeout(t);
          };
    const clear = schedule(() => {
      void saveActiveTripToCache(entry);
    });
    return clear;
  }, [
    fitTrigger,
    routeSlotOrderKey,
    previewLegIndex,
    destLngLat,
    destinationLabel,
    navigationStarted,
    viewMode,
    planRoutesKey,
  ]);

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

  const navPosition = useNavigationPosition({
    rawLngLat: userLngLat,
    navigationStarted: navActiveForGps,
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
    disabled: Boolean(devLocOverrideLngLat),
  });
  const navigationPositionLngLat = navPosition.positionLngLat;
  const navigationPositionLngLatRef = useRef(navigationPositionLngLat);
  navigationPositionLngLatRef.current = navigationPositionLngLat;

  const adoptLockedRouteGeometry = useCallback((geometry: LngLat[]) => {
    navigationGuidanceGeometryRef.current = geometry.map(([a, b]) => [a, b] as LngLat);
    navGoGeometryRef.current = navigationGuidanceGeometryRef.current;
    setGuidanceGeometryEpoch((n) => n + 1);
    setAlongHoldResetKey((n) => n + 1);
  }, []);

  const offRouteNav = useOffRouteNavigation({
    userLngLat: navigationPositionLngLat,
    destLngLat,
    plan,
    orderedRouteIds,
    viaStops,
    activeViaIndex,
    destinationLabel,
    navigationStarted,
    guidanceRoute: offRouteGuidanceRoute,
    guidanceRouteLengthM: offRouteGuidanceRouteLengthM,
    guidanceRouteId: offRouteLockedRouteId ?? primaryRouteId,
    userAlongGuidanceMRef,
    effectiveUserLngLat: navigationPositionLngLat,
    mapboxToken: env.mapboxToken,
    isOnline,
    isPlus,
    effectiveAutoRerouteEnabled: true,
    settingVoiceGuidanceEnabled,
    settingStormEnabled,
    learnEnabled,
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
  });

  const {
    showOffRouteStatusBanner,
    autoRejoinGuidanceRouteId,
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
  const refreshAlternateRoutesOnly = useCallback(
    async (opts?: { allowDuringDrive?: boolean }) => {
      if (!navigationStarted) return;
      if (!opts?.allowDuringDrive && viewMode !== "route") return;
      if (!userLngLat || !destLngLat) return;
      if (env.mapboxToken && !isOnline) return;
      const primaryId = navigationPrimaryRouteIdForMerge(
        lockedNavigationRouteIdRef.current,
        orderedRouteIds
      );
      if (!primaryId || plan.routes.length < 2) return;
      const epochAtStart = routeGraphEpochRef.current;
      if (altRoutesRefreshInFlightRef.current) return;
      altRoutesFetchAbortRef.current?.abort();
      const altFetch = new AbortController();
      altRoutesFetchAbortRef.current = altFetch;
      altRoutesRefreshInFlightRef.current = true;
      try {
        if (env.mapboxToken) {
          const fresh = await collectMapboxRouteVariants(env.mapboxToken, userLngLat, destLngLat, {
            signal: altFetch.signal,
            allowLocalTripThirdRoute: isPlus,
            preferThreeRoutes: isPlus,
            stormAlerts: stormAlertsForRouting,
            radarAvoidanceEnabled: isPlus && settingStormEnabled,
            trailRoutePersonalization: isPlus && learnEnabled,
          });
          if (fresh.length === 0) return;
          if (epochAtStart !== routeGraphEpochRef.current) return;
          setPlan((prev) => mergePlanPreservingPrimary(prev, primaryId, fresh));
        } else {
          const mock = buildMockTripBetween(
            userLngLat,
            destLngLat,
            destinationLabel.trim() || "Destination"
          );
          if (epochAtStart !== routeGraphEpochRef.current) return;
          setPlan((prev) => mergePlanPreservingPrimary(prev, primaryId, mock.routes));
        }
      } catch {
        /* Offline / Mapbox errors — keep prior B/C */
      } finally {
        altRoutesRefreshInFlightRef.current = false;
      }
    },
    [
      navigationStarted,
      viewMode,
      userLngLat,
      destLngLat,
      orderedRouteIds,
      plan.routes.length,
      env.mapboxToken,
      isOnline,
      destinationLabel,
      stormAlertsForRouting,
      isPlus,
      settingStormEnabled,
    ]
  );

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
  const driveMapLineFocusId = trafficBypassCompare?.selectedLeg ?? lineFocusId;

  const suggestedRouteId = useMemo(() => {
    const id = pickSuggestedActive(scored);
    return id || null;
  }, [scored]);

  /** Other leg to try when avoiding worst conditions (suggested, else lowest stress). */
  const alternateBypassRouteId = useMemo(() => {
    if (plan.routes.length < 2) return null;
    if (suggestedRouteId && suggestedRouteId !== lineFocusId) return suggestedRouteId;
    const sorted = [...scored].sort((a, b) => a.stressScore - b.stressScore);
    return sorted.find((s) => s.route.id !== lineFocusId)?.route.id ?? null;
  }, [plan.routes.length, scored, suggestedRouteId, lineFocusId]);

  const routePickItems: RoutePickItem[] = useMemo(() => {
    return orderedRouteIds
      .map((routeId, slot) => {
        const route = plan.routes.find((r) => r.id === routeId);
        if (!route) return null;
        const s = scored.find((x) => x.route.id === routeId);
        const eta = s
          ? Math.round(s.effectiveEtaMinutes)
          : Math.max(1, Math.round(route.baseEtaMinutes));
        const letter = String.fromCharCode(65 + Math.min(slot, 25));
        const routeLabel = route.label.trim() || `Route ${letter}`;
        const item: RoutePickItem = {
          id: route.id,
          letter,
          routeLabel,
          etaMinutes: eta,
          suggested: routeId === suggestedRouteId,
          softPath: route.role === "hazardSmart",
          color: routePickSlotHex(slot),
        };
        if (route.hasTolls) item.hasTolls = true;
        return item;
      })
      .filter((x): x is RoutePickItem => x != null);
  }, [scored, suggestedRouteId, orderedRouteIds, plan.routes]);

  const routeDockDetail = useMemo(() => {
    const r = plan.routes.find((x) => x.id === lineFocusId) ?? plan.routes[0];
    if (!r?.geometry?.length) return undefined;
    const dist = formatRouteDistanceMi(r.geometry);
    const blurb = routeConsiderationSummary(r);
    const tollNote = r.hasTolls ? "Tolls" : "";
    return [dist, blurb, tollNote].filter(Boolean).join(" · ");
  }, [plan.routes, lineFocusId]);

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

  const showDataSaverHint =
    isPlus &&
    !dataSaverMode &&
    !dataSaverHintDismissed &&
    Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2) &&
    isLongTripRoute(maxPlanRouteLengthM);
  const turnSteps = guidanceRoute?.turnSteps ?? [];
  const guidanceSlice = snap.routes.find((r) => r.routeId === guidanceRouteId);

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
    () => getNwsPollIntervalMs(dataSaverMode, navigationStarted, maxPlanRouteLengthM),
    [dataSaverMode, navigationStarted, maxPlanRouteLengthM]
  );

  const liveTrafficNarrative = useMemo(() => {
    if (!guidanceSlice || !guidanceRoute) return null;
    const tLeg = trafficOverlay?.[guidanceRouteId] ?? null;
    const hasLive = Boolean(guidanceSlice.hasLiveTrafficEstimate && tLeg);
    return unifiedTrafficNarrative(
      guidanceSlice.trafficDelayMinutes,
      tLeg,
      hasLive,
      tLeg?.mapboxDurationMinutes ?? guidanceRoute.baseEtaMinutes ?? null
    );
  }, [guidanceSlice, guidanceRoute, guidanceRouteId, trafficOverlay]);

  const trafficDelayMinutesForBypass = useMemo(
    () =>
      Math.max(
        guidanceSlice?.trafficDelayMinutes ?? 0,
        demoBypassTrafficJamPlus ? BYPASS_HEAVY_DELAY_MINUTES : 0
      ),
    [guidanceSlice?.trafficDelayMinutes, demoBypassTrafficJamPlus]
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

  const forecastAreaLabel = useMemo(() => {
    if (forecastPlaceShort) return forecastPlaceShort;
    if (effectiveUserLngLat) {
      const [lng, lat] = effectiveUserLngLat;
      return formatCoordsAreaLabel(lat, lng);
    }
    return "Your location";
  }, [forecastPlaceShort, effectiveUserLngLat]);

  useEffect(() => {
    if (!env.mapboxToken || !effectiveUserLngLat) {
      setForecastPlaceShort(null);
      return;
    }
    const [lng, lat] = effectiveUserLngLat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    let cancelled = false;
    void mapboxReverseGeocode(lng, lat, env.mapboxToken).then((hit) => {
      if (cancelled || !hit?.placeName) return;
      setForecastPlaceShort(shortenPlaceNameForForecast(hit.placeName));
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveUserLngLat, env.mapboxToken]);

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

  const stormRoadDetailRows = useMemo(() => {
    if (!guidanceRoute?.geometry?.length || !guidanceSlice) return [];
    const rows: { label: string; text: ReactNode; actionLabel?: string; onAction?: () => void }[] = [];
    const mapbox = Boolean(env.mapboxToken);

    if (mapbox) {
      if (!isPlus) {
        rows.push({
          label: "Traffic",
          text: (
            <>
              <strong>Plus feature</strong>{" "}
              <span className="storm-advisory-bar__road-muted">
                Live route traffic delay and lane-level stops require Plus.
              </span>
            </>
          ),
        });
      } else if (!settingTrafficEnabled) {
        rows.push({
          label: "Traffic",
          text: (
            <>
              <strong>Fetches off</strong>{" "}
              <span className="storm-advisory-bar__road-muted">
                {isPlus
                  ? "Turn on Traffic overlay in About → Settings."
                  : "Plus: enable Traffic overlay in About (Basic has no corridor delay API)."}
              </span>
            </>
          ),
        });
      } else if (!navigationStarted) {
        rows.push({
          label: "Traffic",
          text: (
            <>
              <strong>Tap Go</strong>{" "}
              <span className="storm-advisory-bar__road-muted">
                Live delay and corridor traffic load after navigation starts.
              </span>
            </>
          ),
        });
      } else if (!trafficFetchDone) {
        rows.push({ label: "Traffic", text: <strong>Fetching live data…</strong> });
      } else if (guidanceSlice.hasLiveTrafficEstimate) {
        const tLeg = trafficOverlay?.[guidanceRouteId];
        const n = liveTrafficNarrative;
        if (hasLocalizedTrafficIssue(tLeg) && n) {
          rows.push({
            label: "Traffic",
            text: <strong>{n.advisoryHeadline}</strong>,
          });
          if (n.advisorySubtext) {
            rows.push({
              label: n.showAdvisoryDelayRow ? "Details" : "Note",
              text: <span className="storm-advisory-bar__road-muted">{n.advisorySubtext}</span>,
            });
          }
        } else if (n?.advisoryHeadline === "Clear — little delay") {
          rows.push({
            label: "Traffic",
            text: (
              <>
                <strong>Clear</strong>{" "}
                <span className="storm-advisory-bar__road-muted">— typical flow on this path.</span>
              </>
            ),
          });
        } else if (!n) {
          rows.push({ label: "Traffic", text: <strong>Live traffic is updating…</strong> });
        }

      } else {
        rows.push({
          label: "Traffic",
          text: (
            <>
              <strong>Traffic unavailable</strong>{" "}
              <span className="storm-advisory-bar__road-muted">
                — Mapbox could not trace this path right now (token scope, transient API issue, or route
                geometry mismatch). Route guidance still works.
              </span>
            </>
          ),
        });
      }
    } else {
      rows.push({
        label: "Traffic",
        text: (
          <>
            <strong>Off</strong>{" "}
            <span className="storm-advisory-bar__road-muted">— add Mapbox token</span>
          </>
        ),
      });
    }

    return rows;
  }, [
    env.mapboxToken,
    guidanceRoute?.geometry,
    guidanceRoute?.routeNotices,
    guidanceRouteId,
    guidanceSlice,
    isPlus,
    navigationStarted,
    scored,
    settingTrafficEnabled,
    trafficFetchDone,
    trafficOverlay,
    liveTrafficNarrative,
  ]);

  const guidanceRouteLengthM = useMemo(() => {
    const g = navigationGuidanceGeometry ?? guidanceRoute?.geometry;
    return g && g.length >= 2 ? polylineLengthMeters(g) : 0;
  }, [navigationGuidanceGeometry, guidanceRoute?.geometry]);

  const {
    userAlongGuidanceM,
    bannerTurnIndex,
    metersToBannerManeuver,
  } = useNavigationGuidance({
    navigationStarted,
    settingVoiceGuidanceEnabled,
    guidanceRouteId,
    guidanceRouteLengthM,
    turnSteps,
    effectiveUserLngLat: navigationPositionLngLat,
    routeGeometry: navigationGuidanceGeometry,
    alongHoldResetKey,
    navigationAlongM: navigationStarted && !autoRejoinGuidanceRouteId ? navPosition.alongM : undefined,
    speedMps,
  });

  guidanceRouteGeomRef.current = navigationGuidanceGeometry ?? guidanceRoute?.geometry ?? null;
  guidanceRouteLengthMRef.current = guidanceRouteLengthM;
  navRouteLengthMRef.current = guidanceRouteLengthM;
  userAlongGuidanceMRef.current = userAlongGuidanceM;

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

  /** Drive camera: align with polyline ahead (not device heading — often missing / wrong in-car). */
  const driveRouteBearingDeg = useMemo(() => {
    const geometry = guidanceRoute?.geometry;
    if (!driveModeUi || !effectiveUserLngLat || !geometry || geometry.length < 2) {
      return null;
    }
    /** Slightly shorter max lookahead than before — long chords across tight corners skewed tangent. */
    const lookAheadM = Math.min(
      155,
      Math.max(42, 42 + (speedMps != null && speedMps > 0 ? speedMps * 4.5 : 0))
    );
    /** If GPS is this far from the point on the line at held progress, use live closest-point tangent. */
    const OFF_ROUTE_FOR_CAMERA_TANGENT_M = 168;

    const totalM = polylineLengthMeters(geometry);
    let b: number | null = null;

    /**
     * While navigating, prefer tangent from **held** along-route progress (same hold as ETA / strip).
     * That avoids closest-point jumping onto parallel ramps / the wrong side of a fork, which flipped
     * the camera. Only when the vehicle is clearly far from that anchor do we use live
     * {@link bearingAlongRouteAhead}.
     */
    if (navigationStarted && Number.isFinite(userAlongGuidanceM) && totalM > 1) {
      const fromAlongM = Math.max(0, Math.min(totalM, userAlongGuidanceM));
      const heldAnchor = pointAtAlongMeters(geometry, fromAlongM);
      const distToHeld = haversineMeters(effectiveUserLngLat, heldAnchor);
      if (distToHeld <= OFF_ROUTE_FOR_CAMERA_TANGENT_M) {
        const toAlongM = Math.min(totalM, fromAlongM + lookAheadM);
        const fromPt = pointAtAlongMeters(geometry, fromAlongM);
        const toPt = pointAtAlongMeters(geometry, Math.max(toAlongM, fromAlongM + 0.5));
        if (haversineMeters(fromPt, toPt) >= 2.5) {
          b = initialBearingDegrees(fromPt, toPt);
        }
      }
    }
    if (b == null) {
      b = bearingAlongRouteAhead(effectiveUserLngLat, geometry, lookAheadM);
    }
    return b;
  }, [
    driveModeUi,
    effectiveUserLngLat,
    guidanceRoute?.geometry,
    guidanceRoute?.id,
    speedMps,
    navigationStarted,
    userAlongGuidanceM,
  ]);

  /** Full-route ETA from scoring; scale by remaining distance while navigating so it tracks progress. */
  const driveEtaMinutes = useMemo(() => {
    const s = scored.find((x) => x.route.id === lineFocusId);
    const full = s
      ? Math.round(s.effectiveEtaMinutes)
      : guidanceRoute
        ? Math.round(guidanceRoute.baseEtaMinutes)
        : null;
    return computeRemainingDriveEtaMinutes({
      navigationStarted,
      fullEtaMinutes: full,
      routeLengthM: guidanceRouteLengthM,
      alongM: userAlongGuidanceM,
      hasRouteGeometry: Boolean(guidanceRoute?.geometry?.length),
    });
  }, [
    navigationStarted,
    scored,
    lineFocusId,
    guidanceRoute,
    guidanceRouteLengthM,
    userAlongGuidanceM,
  ]);

  const driveDistanceRemainingLabel = useMemo(() => {
    const rem = computeRemainingDistanceMeters(
      navigationStarted,
      guidanceRouteLengthM,
      userAlongGuidanceM
    );
    if (rem == null) return null;
    return formatDistanceShort(rem, useMilesForLngLat(effectiveUserLngLat));
  }, [
    navigationStarted,
    guidanceRouteLengthM,
    userAlongGuidanceM,
    effectiveUserLngLat,
  ]);

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
    setAlongHoldResetKey,
    bumpTrafficRefresh,
  });

  /** Merge forecast headline + midpoint sample so the progress strip “heavy wx” band isn’t cloud-only. */
  const corridorWeatherDetail = useMemo(() => {
    if (!lineFocusId) return "";
    const fc = guidanceSlice?.forecastHeadline?.trim() ?? "";
    const ow = weatherOverlay?.[lineFocusId];
    const bits: string[] = [];
    if (fc) bits.push(fc);
    if (ow?.samples?.length) {
      const mid = ow.samples[Math.floor(ow.samples.length / 2)];
      const mh = mid?.headline?.trim() ?? "";
      if (
        mh &&
        !fc.toLowerCase().includes(mh.slice(0, Math.min(14, mh.length)).toLowerCase())
      ) {
        bits.push(mh);
      }
    }
    return bits.join(" · ").replace(/\s+/g, " ").trim();
  }, [lineFocusId, guidanceSlice?.forecastHeadline, weatherOverlay]);

  /** OpenWeather corridor overlay — focused leg (planning + navigation). */
  const weatherOverlayLegId = lineFocusId || primaryRouteId;

  const weatherOverlayGeomKey = useMemo(() => {
    if (!weatherOverlayLegId) return "";
    const g = plan.routes.find((r) => r.id === weatherOverlayLegId)?.geometry;
    if (!g || g.length < 2) return "";
    const f = g[0]!;
    const l = g[g.length - 1]!;
    return `${weatherOverlayLegId}:${g.length}:${Math.round(f[0] * 1000)}:${Math.round(f[1] * 1000)}:${Math.round(l[0] * 1000)}:${Math.round(l[1] * 1000)}`;
  }, [weatherOverlayLegId, plan.routes]);

  const { bumpWeatherRefresh, resetWeatherOverlayThrottle, weatherOverlayRefreshing } =
    useWeatherOverlayFetch({
    planRef,
    routingRef,
    navigationStarted,
    destLngLat,
    isPlus,
    isOnline,
    openWeatherApiKey: env.openWeatherApiKey,
    settingWeatherHintsEnabled,
    settingStormEnabled,
    dataSaverMode,
    progressCalloutsOpen,
    weatherOverlayLegId,
    weatherOverlayGeomKey,
    setWeatherOverlay,
  });

  /** Strip + map corridors: honor the Road checkbox — do not force “on” in drive (that hid toggles but left layers active). */
  const showTrafficCorridorOnRoute = isPlus && roadAdvisoryDetailOn && settingTrafficEnabled;
  const showRoadNoticesOnRoute = isPlus && roadAdvisoryDetailOn;
  const hasPlannedRoute = Boolean(
    destLngLat && plan.routes.some((r) => r.geometry && r.geometry.length >= 2)
  );
  /** Sample RainViewer along the route for advisory/timeline whenever a leg is loaded or Rad is on. */
  const routeLenForCorridorLean =
    guidanceRouteLengthM > 0 ? guidanceRouteLengthM : maxPlanRouteLengthM;
  const ultraLongPlannedRoute = isUltraLongTripRoute(routeLenForCorridorLean);
  const radarRouteSamplingEnabled = Boolean(
    guidanceRoute?.geometry &&
      guidanceRoute.geometry.length >= 2 &&
      (navigationStarted || hasPlannedRoute) &&
      (radarMapOverlayOn ||
        settingStormEnabled ||
        settingWeatherHintsEnabled ||
        progressCalloutsOpen) &&
      (navigationStarted ||
        // For ultra-long routes (>300 mi) only sample when explicitly requested.
        // For long routes (100–300 mi) also enable when Storm mode is on — the user
        // explicitly wants storm data and seeing no Radar bar is confusing.
        (!ultraLongPlannedRoute &&
          (!isLongTripRoute(routeLenForCorridorLean) || settingStormEnabled)) ||
        radarMapOverlayOn ||
        progressCalloutsOpen)
  );
  const radarSampleIntervalMs = getRadarRouteSampleIntervalMs(
    dataSaverMode,
    navigationStarted,
    routeLenForCorridorLean
  );
  const radarMosaicAlongRoute = useRadarBandsAlongRoute(
    radarRouteSamplingEnabled,
    guidanceRoute?.geometry,
    radarSampleIntervalMs,
    guidanceRoute?.baseEtaMinutes ?? null,
    env.tomorrowIoApiKey
  );

  // ── Route weather (Tomorrow.io or Apple WeatherKit) ──
  const weatherKitEnabled = env.weatherKitEnabled;
  const tioApiKey = weatherKitEnabled ? "" : env.tomorrowIoApiKey;
  const routeWeatherReady = weatherKitEnabled || Boolean(env.tomorrowIoApiKey);
  const tioWeatherUiOpen = stormBarExpanded;
  const tioBaseEnabled =
    isPlus && routeWeatherReady && Boolean(effectiveUserLngLat) && appForeground;
  /** At-your-location minute precip + hourly — always on (data saver waits for expanded bar). */
  const tioPointFetchEnabled =
    tioBaseEnabled && (dataSaverMode ? tioWeatherUiOpen : true);
  /** OpenWeather hourly is fallback only — skip when primary provider covers the point card. */
  const openWeatherHourlyEnabled =
    tioPointFetchEnabled && !routeWeatherReady;
  /** Corridor hourly along the active leg — route shape only (no GPS required). */
  const tioRouteCorridorEnabled =
    isPlus &&
    routeWeatherReady &&
    appForeground &&
    Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2);
  /** Fetch while navigating, planning a short route, or advisory weather is expanded. */
  const navLiteForCorridorFetch =
    navigationStarted && (dataSaverMode || isLongTripRoute(routeLenForCorridorLean));
  const tioRouteFetchEnabled =
    tioRouteCorridorEnabled &&
    !(navLiteForCorridorFetch && !tioWeatherUiOpen && !navigationStarted && !progressCalloutsOpen) &&
    (dataSaverMode
      ? tioWeatherUiOpen || navigationStarted || progressCalloutsOpen
      : tioWeatherUiOpen ||
        navigationStarted ||
        progressCalloutsOpen ||
        (hasPlannedRoute && !isLongTripRoute(routeLenForCorridorLean)));
  const tioMinutePrecip = useTomorrowMinutePrecip(
    tioApiKey,
    effectiveUserLngLat ?? null,
    tioPointFetchEnabled,
    navigationStarted,
    weatherKitEnabled
  );
  const localHourlyForecast = useLocalHourlyForecast(
    tioApiKey,
    env.openWeatherApiKey,
    effectiveUserLngLat ?? null,
    tioPointFetchEnabled,
    openWeatherHourlyEnabled,
    weatherKitEnabled
  );
  const {
    forecast: tioRouteForecast,
    bumpRouteForecastRefresh,
    routeForecastRefreshing,
    routeForecastRefreshBlocked,
    routeForecastUsingCache,
  } = useTomorrowRouteForecast(
    tioApiKey,
    isPlus && guidanceRoute?.geometry?.length ? guidanceRoute.geometry : null,
    speedMps ?? 0,
    tioRouteFetchEnabled,
    weatherKitEnabled
  );

  const handleRefreshRouteInfoWeather = useCallback(() => {
    resetWeatherOverlayThrottle();
    bumpWeatherRefresh();
    if (routeWeatherReady && guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2) {
      bumpRouteForecastRefresh();
    }
  }, [
    resetWeatherOverlayThrottle,
    bumpWeatherRefresh,
    bumpRouteForecastRefresh,
    routeWeatherReady,
    guidanceRoute?.geometry,
  ]);

  const routeInfoWeatherRefreshing = routeForecastRefreshing || weatherOverlayRefreshing;

  const prevProgressCalloutsOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = progressCalloutsOpen && !prevProgressCalloutsOpenRef.current;
    prevProgressCalloutsOpenRef.current = progressCalloutsOpen;
    if (!justOpened) return;
    if ((tioRouteForecast?.intervals?.length ?? 0) > 0) return;
    if (!isPlus || !guidanceRoute?.geometry?.length) return;
    handleRefreshRouteInfoWeather();
  }, [
    progressCalloutsOpen,
    tioRouteForecast?.intervals?.length,
    isPlus,
    guidanceRoute?.geometry?.length,
    handleRefreshRouteInfoWeather,
  ]);

  const advisoryNowcastLine = useMemo(() => {
    if (currentNowcast) return formatNowcastLine(currentNowcast);
    if (tioMinutePrecip?.now) return formatMinutePrecipNowLine(tioMinutePrecip.now);
    return null;
  }, [currentNowcast, tioMinutePrecip?.now]);

  /**
   * Enrich corridor weather detail with the worst forecast interval timing.
   * "Thunderstorm in ~42 min" surfaces in the advisory bar and progress copy when the
   * worst corridor segment is mid-route — not just at the destination. No new UI added.
   */
  const enrichedCorridorWeatherDetail = useMemo(() => {
    const base = corridorWeatherDetail;
    if (!tioRouteForecast?.intervals.length) return base;
    const worst = worstCorridorInterval(tioRouteForecast);
    if (!worst) return base;
    if (worst.severity !== "serious" && worst.severity !== "avoid") return base;
    const etaLabel = worst.etaMinutes > 0 ? ` in ~${worst.etaMinutes} min` : "";
    const snapLine = `${worst.headline}${etaLabel} on route · ${worst.detail}`;
    if (base && !base.toLowerCase().includes(worst.headline.toLowerCase())) {
      return `${base} · ${snapLine}`;
    }
    return snapLine;
  }, [corridorWeatherDetail, tioRouteForecast]);

  const localForecastPanelLoading = useMemo(() => {
    if (!isPlus || !stormBarExpanded || !effectiveUserLngLat) return false;
    const hasData =
      Boolean(currentNowcast) ||
      Boolean(tioMinutePrecip) ||
      (localHourlyForecast?.hours.length ?? 0) > 0;
    if (hasData) return false;
    return routeWeatherReady || Boolean(env.openWeatherApiKey);
  }, [
    isPlus,
    stormBarExpanded,
    effectiveUserLngLat,
    currentNowcast,
    tioMinutePrecip,
    localHourlyForecast?.hours.length,
    routeWeatherReady,
    env.openWeatherApiKey,
  ]);

  const radarMosaicMaxIntensity = useMemo(() => {
    const s = radarMosaicAlongRoute.samples;
    const radarMax = s.length ? Math.max(...s.map((x) => x.intensity)) : 0;
    // Safety floor: if corridor forecast says thunderstorm or high precip probability,
    // the advisory banner must reflect at least that severity even if radar hasn't caught up yet.
    const forecastFloor = routeForecastIntensityFloor(tioRouteForecast);
    return Math.max(radarMax, forecastFloor);
  }, [radarMosaicAlongRoute.samples, tioRouteForecast]);

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
    radarMosaicSamples: radarMosaicAlongRoute.samples,
    showTrafficCorridorOnRoute,
    showRoadNoticesOnRoute,
    driveEtaMinutes,
    viewMode,
    trafficDelayMinutesForBypass,
    mapboxToken: env.mapboxToken,
    destLngLat,
    roadAdvisoryDetailOn,
    settingTrafficEnabled,
    trafficBypassCompare,
    guidanceRouteId,
    planRoutes: plan.routes,
    lockedNavigationRouteId,
    temporaryGuidanceRouteId: autoRejoinGuidanceRouteId,
    stormMapGeoJson,
  });

  /** Map fit + draw: full guidance geometry; layers apply display-tier subsampling. */
  const driveMapRoutesForMap = useMemo(() => {
    const full = navigationGuidanceGeometry;
    if (!navigationStarted || !full?.length) return driveMapRoutes;
    return driveMapRoutes.map((r) =>
      r.id === lockedNavigationRouteId || r.id === guidanceRouteId ? { ...r, geometry: full } : r
    );
  }, [
    driveMapRoutes,
    navigationStarted,
    navigationGuidanceGeometry,
    lockedNavigationRouteId,
    guidanceRouteId,
  ]);

  /** Cruise demo puck along the active route polyline at ~posted speed (see `toggleDemoPlaybackPlaying`). */
  useEffect(() => {
    if (!demoPlaybackPlaying || !demoBypassTrafficJamPlus || !navigationStarted) return;
    const g = guidanceRoute?.geometry;
    if (!g?.length) {
      setDemoPlaybackPlaying(false);
      return;
    }
    const totalM = polylineLengthMeters(g);
    if (totalM < 2) {
      setDemoPlaybackPlaying(false);
      return;
    }
    const mph = postedMph ?? 55;
    const mPerSec = (mph * 1609.344) / 3600;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dtSec = Math.min(0.28, Math.max(0, (now - last) / 1000));
      last = now;
      const prev = demoPlaybackAlongRef.current;
      const cur =
        prev ??
        (userLngLatRef.current ? closestAlongRouteMeters(userLngLatRef.current, g).alongMeters : totalM * 0.12);
      const next = Math.min(totalM - 0.5, cur + mPerSec * dtSec);
      demoPlaybackAlongRef.current = next;
      setDemoPlaybackAlongM(next);
      if (next >= totalM - 0.55) {
        setDemoPlaybackPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [
    demoPlaybackPlaying,
    demoBypassTrafficJamPlus,
    navigationStarted,
    guidanceRoute?.geometry,
    guidanceRouteId,
    postedMph,
  ]);

  /**
   * Map line highlights — paint each corridor alert at its real along-route position.
   *
   * The progress strip uses {@link layoutStripAlerts} to bunch marks into the “ahead” half so
   * they’re visible on a small bar; that re-anchoring is wrong for the map, where it makes the
   * orange halo slide down the route as the puck advances. Map highlights stay anchored to the
   * actual hazard location (or the impact center for non-spatial alerts) instead.
   */
  const mapAlongRouteAlerts = useMemo(() => {
    const g = guidanceRoute?.geometry;
    if (!g?.length) return [];
    const roadFromTimeline = timelineToMapCorridorAlerts(routeAheadTimeline, advisoryRouteImpacts);
    const byId = new Map<string, RouteAlert>();
    for (const a of [...progressStripAlerts, ...roadFromTimeline]) {
      if (!routeAlertShowsOnRouteLine(a)) continue;
      byId.set(a.id, a);
    }
    return [...byId.values()];
  }, [progressStripAlerts, guidanceRoute?.geometry, routeAheadTimeline, advisoryRouteImpacts]);

  /**
   * NWS warning polygons on the map (Rt / Mp; hidden in Dr). Independent of radar overlay.
   * Plus: follows the advisory panel **NWS polygons** checkbox (`stormSessionOn`).
   */
  const nwsAlertGeoJsonForMap = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!isPlus) return null;
    if (!advisoryLifeSafetyOn || !settingStormEnabled) return null;
    // Display gate only — fetch effect below keeps `stormMapGeoJson` warm while unchecked.
    if (isPlus && !stormSessionOn) return null;

    // Browse mode (no route): Plus users see regional alert polygons; basic sees radar only.
    if (!nwsMapOverlapRouteGeom?.length) {
      if (!isPlus) return null;
      const withGeom = stormCorridorAlerts.filter((a) => a.geometry);
      if (withGeom.length) return mapGeoJsonFromAlerts(withGeom);
      if (stormMapGeoJson?.features?.length) return stormMapGeoJson;
      return null;
    }

    // Route active — corridor-wide polygons (SVR boxes, fog zones, etc. along the trip).
    const base = stormMapGeoJsonForMap;
    if (base?.features.length) return base;

    const corridorGeom = stormCorridorAlerts.filter((a) => a.geometry);
    if (corridorGeom.length) return mapGeoJsonFromAlerts(corridorGeom);

    const onRouteGeom = nwsAlertsAffectingActiveRoute.filter((a) => a.geometry);
    if (onRouteGeom.length) return mapGeoJsonFromAlerts(onRouteGeom);

    return null;
  }, [
    advisoryLifeSafetyOn,
    settingStormEnabled,
    isPlus,
    stormSessionOn,
    nwsMapOverlapRouteGeom,
    stormMapGeoJsonForMap,
    nwsAlertsAffectingActiveRoute,
    stormCorridorAlerts,
    stormMapGeoJson,
  ]);

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
  const mapAlongRouteAlertsForDrive = activeTripMapOverlays ? deferredMapAlongRouteAlerts : [];
  const mapStormAlongRouteBandsForDrive = activeTripMapOverlays ? deferredRouteAheadMapBands : [];
  const driveRouteAheadLine = useMemo(() => {
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

  /** Same ~2 mi heads-up in Rt / Map / Dr while navigating — not drive-only. */
  const hazardApproachAlertsActive =
    isPlus &&
    navigationStarted &&
    Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2);

  /**
   * Demo (`?demo=bypass` + Plus): fabricate a high-confidence rerouteRecommended impact ~1.4 mi
   * ahead so we can test the approach banner UI without a real-world hazard. Tapping this banner
   * routes to {@link openDemoTrafficBypassCompareMock} so the full flow works without Mapbox calls.
   */
  const demoApproachBannerImpact = useMemo<RouteImpact | null>(() => {
    if (!demoBypassTrafficJamPlus) return null;
    /* "Close hazard" wins when both demos are on so we can verify the adaptive next-exit window. */
    const usingClose = demoCloseHazardOn;
    if (!usingClose && !demoApproachBannerOn) return null;
    const g = guidanceRoute?.geometry;
    if (!g?.length) return null;
    const totalM = polylineLengthMeters(g);
    const userAlong = Number.isFinite(userAlongGuidanceM) ? userAlongGuidanceM : 0;
    /* Close = 0.6 mi ahead (forces the surgical-bypass tier into "next-exit"). Far = 1.4 mi. */
    const aheadDistMi = usingClose ? 0.6 : 1.4;
    const ahead = Math.min(totalM - 100, userAlong + aheadDistMi * 1609.344);
    const distAhead = Math.max(0, ahead - userAlong);
    if (distAhead <= 200) return null;
    return {
      id: usingClose ? "demo-close-hazard" : "demo-approach-banner",
      category: "traffic",
      severity: "serious",
      confidence: "high",
      source: "mapboxTraffic",
      lngLat: pointAtAlongMeters(g, ahead),
      alongMeters: ahead,
      startMeters: ahead,
      endMeters: ahead,
      distanceAheadMeters: distAhead,
      etaAheadMinutes: null,
      driverHeadline: usingClose
        ? "Demo: hazard right ahead"
        : "Demo: heavy traffic ahead",
      driverAction: "rerouteRecommended",
      roadEffect: usingClose
        ? "Demo only — tests close-in next-exit bypass behavior."
        : "Demo only — tap to test the bypass options flow.",
      detail: usingClose
        ? "Mock close hazard ~0.6 mi ahead to exercise the adaptive surgical bypass."
        : "Mock impact to drive the approach banner / compare-panel UI without a real-world hazard.",
      numericSeverity: 80,
    };
  }, [
    demoBypassTrafficJamPlus,
    demoApproachBannerOn,
    demoCloseHazardOn,
    guidanceRoute?.geometry,
    userAlongGuidanceM,
  ]);

  const driveApproachBannerPick = useMemo(() => {
    if (!hazardApproachAlertsActive) return null;
    if (demoApproachBannerImpact) {
      return {
        impact: demoApproachBannerImpact,
        phase: "near" as const,
      };
    }
    return pickDriveApproachBanner(
      routeImpactsForUi,
      driveApproachDismissedIds,
      earlyApproachMaxMetersForSpeed(speedMps)
    );
  }, [
    hazardApproachAlertsActive,
    demoApproachBannerImpact,
    routeImpactsForUi,
    driveApproachDismissedIds,
    speedMps,
  ]);

  useEffect(() => {
    setDriveApproachDismissedIds(new Set());
  }, [navigationStarted, guidanceRouteId]);

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
      weatherOverlay,
      corridorWeatherDetail: enrichedCorridorWeatherDetail,
      lineFocusId,
      tioRouteForecast,
      radarMosaicSamples: radarMosaicAlongRoute.samples,
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
      bumpWeatherRefresh,
      resetWeatherOverlayThrottle,
      bumpTrafficRefresh,
    });

  /** Map polygon visibility only — NWS poll + `stormMapGeoJson` cache keep running while off. */
  const onStormSessionToggle = useCallback((on: boolean) => {
    setStormSessionOn(on);
    writeNwsSessionOn(on);
  }, []);

  const onRoadAdvisoryDetailToggle = useCallback((on: boolean) => {
    setRoadAdvisoryDetailOn(on);
    writeRoadAdvisoryDetailOn(on);
  }, []);

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

  /* Persistence for the 10 settings now lives inside `useSettingsStore` (Phase 4a). The
   * effects below only react to *changes* in a setting to clean up App-owned state — they no
   * longer call `writeXSettingOn`/`safeStorage.set` since the store action already did that. */
  useEffect(() => {
    if (!settingTrafficEnabled) setTrafficOverlay(undefined);
  }, [settingTrafficEnabled]);

  useEffect(() => {
    if (!settingWeatherHintsEnabled && !settingStormEnabled) setWeatherOverlay(undefined);
  }, [settingWeatherHintsEnabled, settingStormEnabled]);

  useEffect(() => {
    if (!settingRadarEnabled) {
      setShowRadar(false);
      writeRadarOverlayOn(false);
    }
  }, [settingRadarEnabled]);

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

  useEffect(() => {
    seriousHazardAutoFlewRef.current.clear();
  }, [guidanceRouteId]);

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

  useEffect(() => {
    if (!navigationStarted || viewMode !== "drive") return;
    if (!guidanceRoute?.geometry?.length || !userLngLat) return;
    /* Auto fly-to a serious upcoming impact (storm, closure, blocked crash). Reads from the unified
     * impact list so weather is included alongside road incidents — earlier picks were RouteAlert-only and
     * missed serious NWS warnings. */
    const candidate = deferredRouteImpactsForUi.find(
      (i) =>
        (i.severity === "avoid" || i.severity === "serious") &&
        (i.driverAction === "rerouteRecommended" ||
          i.driverAction === "rerouteAvailable" ||
          i.driverAction === "prepare") &&
        i.distanceAheadMeters != null &&
        i.distanceAheadMeters > 0 &&
        i.distanceAheadMeters <= DRIVE_AHEAD_WINDOW_M
    );
    if (!candidate) return;
    if (seriousHazardAutoFlewRef.current.has(candidate.id)) return;
    seriousHazardAutoFlewRef.current.add(candidate.id);
    setMapFocus({
      kind: "hazardOverview",
      hazardLng: candidate.lngLat[0]!,
      hazardLat: candidate.lngLat[1]!,
    });
  }, [navigationStarted, viewMode, guidanceRoute?.geometry, guidanceRouteId, heavyAdvisoryAlongM, deferredRouteImpactsForUi]);

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

  /** Basic: status strip (forecast + offers). Plus: full storm advisory when enabled. */
  const showStormAdvisoryChrome = isPlus ? advisoryLifeSafetyOn : true;

  const showProgressRail =
    isPlus &&
    !trafficBypassCompare &&
    Boolean(progressRailRoute?.geometry && progressRailRoute.geometry.length >= 2);

  useProgressRailFootInset(showProgressRail);

  /** Matches map: planning uses A/B/C preview; after Go the active leg reads as primary blue. */
  const progressStripRouteColor = useMemo(() => {
    if (!guidanceRoute) return routePickSlotHex(0);
    if (navigationStarted) return routePickSlotHex(0);
    return routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds));
  }, [guidanceRoute, orderedRouteIds, navigationStarted]);

  const radarFrameClockLabel = useMemo(() => {
    if (!radarMapOverlayOn || radarFrameUtcSec == null) return null;
    return new Date(radarFrameUtcSec * 1000).toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [radarMapOverlayOn, radarFrameUtcSec]);

  const radarFrameTimeLabel = useMemo(() => {
    if (!radarFrameClockLabel) return null;
    return new Date(radarFrameUtcSec! * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [radarFrameClockLabel, radarFrameUtcSec]);

  const activityTrailGeoJsonForMap = useMemo(() => {
    if (!isPlus || !activityTrailMapOn) return null;
    const s = loadActivitySamples();
    if (!s.length) return null;
    return activitySamplesToGeoJson(s);
  }, [isPlus, activityTrailMapOn, activityTrailTick]);

  const activityTrailPlanningBounds = useMemo(() => {
    if (!isPlus || !learnEnabled) return null;
    return getActivityTrailPlanningBounds(ACTIVITY_MIN_SAMPLES_PLANNING_MAP);
  }, [isPlus, learnEnabled, activityTrailTick]);

  const homePreloadBounds = useMemo(() => {
    if (!isPlus || !learnEnabled || !homePreloadEnabled) return null;
    return getHomePreloadBounds();
  }, [isPlus, learnEnabled, homePreloadEnabled, activityTrailTick]);

  const homePreloadSizeLabel = useMemo(
    () => estimatePreloadStorageLabel(homePreloadBounds),
    [homePreloadBounds]
  );

  const activityTrailAboutPanel = useMemo(() => {
    if (!isPlus) return null;
    const s = getActivityTrailStats();
    const fmt = (ts: number | null) =>
      ts == null
        ? "—"
        : new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return {
      count: s.count,
      spanDays: s.spanDays,
      oldestLabel: fmt(s.oldest),
      newestLabel: fmt(s.newest),
      learnEnabled,
      onLearnEnabledChange: (on: boolean) => setLearnEnabled(on),
      showOnMap: activityTrailMapOn,
      onShowOnMapChange: (on: boolean) => {
        setActivityTrailMapOn(on);
        safeStorage.set(ACTIVITY_TRAIL_MAP_LS, on ? "1" : "0");
      },
      homeMapFraming,
      onHomeMapFramingChange: (mode: HomeMapFraming) => {
        setHomeMapFraming(mode);
        writeHomeMapFraming(mode);
      },
      homeAreaAvailable: activityTrailPlanningBounds != null,
      homePreloadEnabled,
      onHomePreloadEnabledChange: (on: boolean) => {
        setHomePreloadEnabled(on);
        writeHomePreloadEnabled(on);
      },
      homePreloadAvailable: homePreloadBounds != null,
      homePreloadSizeLabel,
      onClear: () => {
        clearActivitySamples();
        clearHomePreloadRecord();
        setActivityTrailTick((n) => n + 1);
      },
    };
  }, [
    isPlus,
    activityTrailMapOn,
    activityTrailTick,
    learnEnabled,
    setLearnEnabled,
    homeMapFraming,
    activityTrailPlanningBounds,
    homePreloadEnabled,
    homePreloadBounds,
    homePreloadSizeLabel,
  ]);

  const idleHomeMapFraming: HomeMapFraming = isPlus ? homeMapFraming : "my_location";

  const clearRoute = () => {
    if (navigationStartedRef.current && payFrequentRoutes && learnEnabled) {
      const started = navGoStartedAtRef.current;
      const geom = navGoGeometryRef.current;
      if (geom && started) {
        const trip = completedTripFromGeometry(geom, started);
        if (trip) recordLearnedTrip(trip);
      }
      resetTripLearningMachine();
      navGoStartedAtRef.current = null;
      navGoGeometryRef.current = null;
    }
    lockedNavigationRouteIdRef.current = null;
    resetOffRouteNavigation();
    routeGraphEpochRef.current += 1;
    routeMainFetchAbortRef.current?.abort();
    routeMainFetchAbortRef.current = null;
    altRoutesFetchAbortRef.current?.abort();
    altRoutesFetchAbortRef.current = null;
    setProgressCalloutsOpen(false);
    setPlan(EMPTY_TRIP);
    setDestLngLat(null);
    setViaStops([]);
    setActiveViaIndex(0);
    setAddingViaStop(false);
    setSearchText("");
    setDestinationLabel("");
    setSearchPickHits(null);
    searchPickQueryRef.current = null;
    setSuggestions([]);
    setRouteError(null);
    setSearchExpanded(true);
    setAllowAutocomplete(true);
    setRouteSlotOrder([]);
    setPreviewLegIndex(0);
    seriousHazardAutoFlewRef.current.clear();
    resetNavigationPlanning();
    setViewMode("topdown");
    setRecenterPlanningPuckTick((n) => n + 1);
    setRouteHazardSheet(null);
    setTollRoutePrompt(null);
    setTollAvoidFailureNote(null);
    tollAcceptedRouteIdsRef.current.clear();
    pendingGoAfterTollRef.current = false;
    setMapFocus(null);
    setBypassBusy(false);
    setRouting(false);
    setTrafficBypassCompare(null);
    setTollCompareContext(null);
    setDemoPlaybackPlaying(false);
    setDemoPlaybackAlongM(null);
    void clearActiveTripCache();
  };

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
      }
      clearDetourGuidance();
    },
    [plan.routes, planRouteIds, clearDetourGuidance]
  );

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

  const handleTrafficBypassCompareSelect = useCallback((id: "r-a" | "r-b" | "r-c") => {
    setTrafficBypassCompare((prev) => (prev ? { ...prev, selectedLeg: id } : null));
    setFitTrigger((n) => n + 1);
  }, []);

  const handleTrafficBypassCompareCancel = useCallback(() => {
    const tollCtx = getTollCompareContext();
    if (tollCtx) {
      setTollCompareContext(null);
      setTrafficBypassCompare(null);
      setPlan(tollCtx.originalPlan);
      setRouteSlotOrder(tollCtx.originalSlotOrder);
      setPreviewLegIndex(tollCtx.originalPreviewLegIndex);
      setViewModeBeforeTrafficBypass(null);
      setViewMode(viewModeAfterCompareCancel(tollCtx.originalViewMode, navigationStarted));
      setFitTrigger((n) => n + 1);
      const route = tollCtx.originalPlan.routes.find((r) => r.id === tollCtx.originalRouteId);
      if (
        tollBypassEnabled &&
        route?.hasTolls &&
        !tollAcceptedRouteIdsRef.current.has(tollCtx.originalRouteId)
      ) {
        setTollRoutePrompt({ routeId: tollCtx.originalRouteId, labels: route.tollLabels ?? [] });
      }
      return;
    }

    setTrafficBypassCompare(null);
    const restore = getViewModeBeforeTrafficBypass();
    setViewModeBeforeTrafficBypass(null);
    setViewMode(viewModeAfterCompareCancel(restore, navigationStarted));
    setFitTrigger((n) => n + 1);
  }, [
    tollBypassEnabled,
    navigationStarted,
    setTrafficBypassCompare,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setTollRoutePrompt,
  ]);

  const toggleDemoPlaybackPlaying = useCallback(() => {
    if (!demoBypassTrafficJamPlus || !guidanceRoute?.geometry?.length) return;
    const g = guidanceRoute.geometry;
    if (polylineLengthMeters(g) < 2) return;
    setDemoPlaybackPlaying((p) => !p);
  }, [demoBypassTrafficJamPlus, guidanceRoute]);

  const resetDemoPlaybackAlongRoute = useCallback(() => {
    setDemoPlaybackPlaying(false);
    setDemoPlaybackAlongM(null);
  }, []);

  /** `?demo=bypass`: open A/B/C compare without Mapbox — uses current plan lines for map flags only. */
  const openDemoTrafficBypassCompareMock = useCallback(() => {
    if (!demoBypassTrafficJamPlus || !navigationStarted) return;
    if (trafficBypassCompareRef.current) return;
    const gr = guidanceRoute;
    if (!gr?.geometry?.length) return;
    const base = Math.max(8, Math.round(gr.baseEtaMinutes ?? 30));
    const totalM = polylineLengthMeters(gr.geometry);
    const userAlong = Number.isFinite(userAlongGuidanceM) ? userAlongGuidanceM : 0;
    const mockJamAlong = Math.min(totalM - 50, userAlong + Math.max(800, (totalM - userAlong) * 0.32));
    activateRouteCompare(
      withTrafficBypassCompareKind({
        headline: "Demo: mock bypass compare (no network)",
        etaA: base,
        etaB: Math.max(6, base - 4),
        etaC: Math.max(6, base - 2),
        hasB: true,
        hasC: true,
        confidence: "medium",
        selectedLeg: defaultRouteCompareSelection(guidanceRouteId),
        hazardLngLat: pointAtAlongMeters(gr.geometry, mockJamAlong),
        hazardAlongMeters: mockJamAlong,
      })
    );
  }, [demoBypassTrafficJamPlus, navigationStarted, guidanceRoute, userAlongGuidanceM, guidanceRouteId, activateRouteCompare]);

  const proceedGo = useCallback(() => {
    const chosen = orderedRouteIds[previewLegIndex] ?? orderedRouteIds[0] ?? primaryRouteId;
    if (!chosen) return;
    setRouteSlotOrder((prev) => slotOrderAfterSelect(prev.length ? prev : planRouteIds, chosen));
    setPreviewLegIndex(0);
    setNavigationStarted(true);
    setViewMode("drive");
    setFitTrigger((n) => n + 1);
    setTollRoutePrompt(null);
    setTollAvoidFailureNote(null);
    // Force a fresh route weather fetch the moment the user starts driving.
    // Bypasses the per-location cache so stale data can't mask a developing storm.
    bumpRouteForecastRefresh();

    const pickedForNav = plan.routes.find((r) => r.id === chosen);
    lockedNavigationRouteIdRef.current = chosen;
    navGoStartedAtRef.current = Date.now();
    navGoGeometryRef.current = pickedForNav?.geometry?.length
      ? pickedForNav.geometry.map(([a, b]) => [a, b] as LngLat)
      : null;
    navigationGuidanceGeometryRef.current = navGoGeometryRef.current;
    setGuidanceGeometryEpoch((n) => n + 1);

    if (userLngLat && destLngLat) {
      const picked = pickedForNav;
      if (picked?.geometry && picked.geometry.length >= 2) {
        const [lng, lat] = userLngLat;
        const originLabel = isGenericOriginLabel(plan.originLabel)
          ? formatCoordsAreaLabel(lat, lng)
          : plan.originLabel.trim();
        setReturnTripLeg(
          persistReturnTripLegOnGo({
            returnToLngLat: userLngLat,
            returnToLabel: originLabel,
            outboundDestLngLat: destLngLat,
            outboundDestLabel: destinationLabel.trim() || "Destination",
            geometry: picked.geometry.map(([a, b]) => [a, b] as LngLat),
          })
        );
      }
    }

    // Learn the preferred A/B/C “role” for this destination area.
    if (payFrequentRoutes && destLngLat && destinationLabel.trim()) {
      const key = areaKeyFromLngLat(destLngLat);
      const picked = plan.routes.find((r) => r.id === chosen);
      if (picked) {
        const now = Date.now();
        const areaLabel = areaLabelFromDestinationLabel(destinationLabel);
        const map = preferredAreaRouteMapRef.current;
        const prev = map[key];
        map[key] = {
          areaKey: key,
          areaLabel,
          preferredRole: picked.role,
          pickCount: (prev?.pickCount ?? 0) + 1,
          lastPickedMs: now,
        };
        savePreferredAreaRouteMap(map);
      }
    }
  }, [
    orderedRouteIds,
    previewLegIndex,
    primaryRouteId,
    planRouteIds,
    payFrequentRoutes,
    destLngLat,
    destinationLabel,
    plan.routes,
    plan.originLabel,
    userLngLat,
    viaStops,
    activeViaIndex,
    bumpRouteForecastRefresh,
  ]);

  const handleGo = () => {
    const chosen = orderedRouteIds[previewLegIndex] ?? orderedRouteIds[0] ?? primaryRouteId;
    if (!chosen) return;
    const route = plan.routes.find((r) => r.id === chosen);
    if (
      tollBypassEnabled &&
      route?.hasTolls &&
      !tollAcceptedRouteIdsRef.current.has(chosen)
    ) {
      pendingGoAfterTollRef.current = true;
      setTollRoutePrompt({ routeId: chosen, labels: route.tollLabels ?? [] });
      return;
    }
    proceedGo();
  };

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

  const handleTrafficBypassCompareConfirm = useCallback(() => {
    const tollCtx = getTollCompareContext();
    const prev = trafficBypassCompareRef.current;
    const id = prev?.selectedLeg;
    if (!id) return;

    if (tollCtx) {
      setTollCompareContext(null);
      setTrafficBypassCompare(null);
      setViewModeBeforeTrafficBypass(null);

      if (id === "r-b") {
        const p =
          !isPlus && tollCtx.fullTollFreePlan.routes.length > 2
            ? { ...tollCtx.fullTollFreePlan, routes: tollCtx.fullTollFreePlan.routes.slice(0, 2) }
            : tollCtx.fullTollFreePlan;
        setPlan(p);
        setRouteSlotOrder(p.routes.map((r) => r.id));
        setPreviewLegIndex(0);
        setTollAvoidFailureNote(null);
        setTollRoutePrompt(null);
        setTapHint("Updated to a toll-free route.");
        window.setTimeout(() => setTapHint(null), 5500);
        setViewMode("route");
      } else {
        setPlan(tollCtx.originalPlan);
        setRouteSlotOrder(tollCtx.originalSlotOrder);
        setPreviewLegIndex(tollCtx.originalPreviewLegIndex);
        tollAcceptedRouteIdsRef.current.add(tollCtx.originalRouteId);
        setTollRoutePrompt(null);
        if (tollCtx.pendingGo) {
          pendingGoAfterTollRef.current = false;
          proceedGo();
        } else {
          setViewMode(tollCtx.originalViewMode);
        }
      }
      setFitTrigger((n) => n + 1);
      return;
    }

    handlePromoteRouteToPrimary(id);
    const promoted = plan.routes.find((r) => r.id === id);
    if (promoted?.geometry?.length && navigationStartedRef.current) {
      navigationGuidanceGeometryRef.current = promoted.geometry.map(([a, b]) => [a, b] as LngLat);
      setGuidanceGeometryEpoch((n) => n + 1);
      setAlongHoldResetKey((n) => n + 1);
    }
    setTrafficBypassCompare(null);
    setViewModeBeforeTrafficBypass(null);
    setViewMode("drive");
    setFitTrigger((n) => n + 1);
    setTapHint("Switched to your chosen route.");
    window.setTimeout(() => setTapHint(null), 5000);
  }, [
    handlePromoteRouteToPrimary,
    proceedGo,
    isPlus,
    setTrafficBypassCompare,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setTollRoutePrompt,
    setTapHint,
    plan.routes,
  ]);

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

  const flushMapFocus = useCallback(() => {
    setMapFocus(null);
  }, []);

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

  const handleDriveCameraBearingDeg = useCallback((deg: number | null) => {
    setDriveMapBearingDeg((prev) => {
      if (deg == null) return null;
      if (prev != null && Math.abs(prev - deg) < 1.5) return prev;
      return deg;
    });
  }, []);

  const buildRouteCompareFromPlan = useCallback(
    (opts: {
      headline: string;
      hazardLngLat: LngLat | null;
      hazardAlongMeters: number | null;
      confidence?: "low" | "medium" | "high";
      etaOverrides?: {
        etaB?: number | null;
        etaC?: number | null;
        hasB?: boolean;
        hasC?: boolean;
      };
    }): TrafficBypassCompareState | null => {
      if (!guidanceRoute?.geometry?.length) return null;
      const etaForSlot = (id: "r-a" | "r-b" | "r-c"): number | null => {
        if (id === "r-a" && navigationStarted && driveEtaMinutes != null) {
          return Math.max(1, Math.round(driveEtaMinutes));
        }
        const s = scored.find((x) => x.route.id === id);
        if (s) return Math.max(1, Math.round(s.effectiveEtaMinutes));
        const r = plan.routes.find((x) => x.id === id);
        return r ? Math.max(1, Math.round(r.baseEtaMinutes)) : null;
      };
      const rB = plan.routes.find((r) => r.id === "r-b");
      const rC = plan.routes.find((r) => r.id === "r-c");
      const hasB =
        opts.etaOverrides?.hasB ?? Boolean(rB?.geometry && rB.geometry.length >= 2);
      const hasC =
        opts.etaOverrides?.hasC ?? Boolean(rC?.geometry && rC.geometry.length >= 2);
      const etaA = etaForSlot("r-a");
      if (etaA == null) return null;
      const altWithGeom = plan.routes.some(
        (r) => r.id !== guidanceRouteId && (r.geometry?.length ?? 0) >= 2
      );
      if (!hasB && !hasC && !altWithGeom) return null;
      return withTrafficBypassCompareKind({
        headline: opts.headline,
        etaA,
        etaB: opts.etaOverrides?.etaB ?? (hasB ? etaForSlot("r-b") : null),
        etaC: opts.etaOverrides?.etaC ?? (hasC ? etaForSlot("r-c") : null),
        hasB,
        hasC,
        confidence: opts.confidence ?? "medium",
        selectedLeg: defaultRouteCompareSelection(guidanceRouteId),
        hazardLngLat: opts.hazardLngLat,
        hazardAlongMeters: opts.hazardAlongMeters,
      });
    },
    [guidanceRoute, plan.routes, scored, driveEtaMinutes, navigationStarted, guidanceRouteId]
  );

  const openRouteCompareFromPlan = useCallback(
    (opts: Parameters<typeof buildRouteCompareFromPlan>[0]) => {
      const state = buildRouteCompareFromPlan(opts);
      if (!state) return false;
      activateRouteCompare(state);
      return true;
    },
    [buildRouteCompareFromPlan, activateRouteCompare]
  );

  const handleQuickReportIssue = useCallback(() => {
    const to = env.supportEmail?.trim();
    if (!to) {
      const site = env.supportUrl?.trim();
      if (site) window.open(site, "_blank", "noopener,noreferrer");
      return;
    }
    const versionLabel = stormpathVersionLabel();
    const subject = encodeURIComponent(`StormPath quick issue report (${versionLabel})`);
    const quickDiag = [
      `App: StormPath ${versionLabel}`,
      `Online: ${typeof navigator === "undefined" ? "unknown" : navigator.onLine ? "yes" : "no"}`,
      `View: ${viewMode}`,
      `Navigating: ${navigationStarted ? "yes" : "no"}`,
      `Destination set: ${destLngLat ? "yes" : "no"}`,
    ].join("\n");
    const body = encodeURIComponent(
      `Describe what happened:\n\nExpected:\n\nWhat you were doing (route/area/time):\n\nQuick diagnostics:\n${quickDiag}\n`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }, [env.supportEmail, env.supportUrl, viewMode, navigationStarted, destLngLat]);

  const handleAdvisoryNwsClick = useCallback(
    (alert: NormalizedWeatherAlert) => {
      if (!lineFocusId) return;
      const geom = guidanceRoute?.geometry;
      if (!geom?.length) return;
      const band = advisoryStormStripBands.find((b) => b.alertId === alert.id);
      const routeAlert = routeAlertForNwsAdvisoryClick(alert, geom, band ?? null);
      if (!routeAlert) return;
      setRouteHazardSheet({
        routeId: lineFocusId,
        alerts: [routeAlert],
      });
    },
    [guidanceRoute?.geometry, lineFocusId, advisoryStormStripBands]
  );

  /** Explicit compare from GPS — used for off-route recovery and traffic bypass. Never auto-applies. */
  const openRouteCompareFromHere = useCallback(
    async (opts?: {
      headline?: string;
      anchorAlongMeters?: number;
      anchorLngLat?: LngLat;
      confidence?: "low" | "medium" | "high";
    }) => {
      const originLngLat =
        demoBypassTrafficJamPlus && effectiveUserLngLat ? effectiveUserLngLat : userLngLat;
      if (!env.mapboxToken || !originLngLat || !destLngLat || !guidanceRoute?.geometry?.length) return;
      const epochAtStart = routeGraphEpochRef.current;
      setBypassBusy(true);
      const geom = guidanceRoute.geometry;
      const totalM = polylineLengthMeters(geom);
      const jamAlongM =
        opts?.anchorAlongMeters ??
        Math.min(totalM - 50, userAlongGuidanceM + Math.max(600, (totalM - userAlongGuidanceM) * 0.32));
      const hazardLngLat = opts?.anchorLngLat ?? pointAtAlongMeters(geom, jamAlongM);
      const compareHeadline = opts?.headline ?? "Routes from your location";

      try {
        const fresh = await collectMapboxRouteVariants(env.mapboxToken, originLngLat, destLngLat, {
          allowLocalTripThirdRoute: isPlus,
          preferThreeRoutes: isPlus,
          stormAlerts: stormAlertsForRouting,
          radarAvoidanceEnabled: isPlus && settingStormEnabled,
          trailRoutePersonalization: isPlus && learnEnabled,
        });

        if (fresh.length === 0 || epochAtStart !== routeGraphEpochRef.current) {
          const opened = openRouteCompareFromPlan({
            headline: compareHeadline,
            hazardLngLat,
            hazardAlongMeters: jamAlongM,
            confidence: opts?.confidence ?? "medium",
          });
          if (!opened) {
            setViewModeBeforeTrafficBypass(null);
            setTapHint("No alternate routes available right now — try again in a moment.");
            window.setTimeout(() => setTapHint(null), 6000);
          }
          return;
        }

        const byId = new Map(fresh.map((r) => [r.id, r]));
        setPlan((prev) => ({
          ...prev,
          routes: prev.routes.map((r) => byId.get(r.id) ?? r),
        }));

        const etaFor = (id: "r-a" | "r-b" | "r-c") => {
          const r = byId.get(id);
          return r?.geometry?.length && r.geometry.length >= 2
            ? Math.max(1, Math.round(r.baseEtaMinutes))
            : null;
        };
        const etaA = etaFor("r-a");
        if (etaA == null) {
          setViewModeBeforeTrafficBypass(null);
          setTapHint("Could not build route options — try again.");
          window.setTimeout(() => setTapHint(null), 5000);
          return;
        }

        activateRouteCompare(
          withTrafficBypassCompareKind({
            headline: compareHeadline,
            etaA,
            etaB: etaFor("r-b"),
            etaC: etaFor("r-c"),
            hasB: Boolean(byId.get("r-b")?.geometry && byId.get("r-b")!.geometry.length >= 2),
            hasC: Boolean(byId.get("r-c")?.geometry && byId.get("r-c")!.geometry.length >= 2),
            confidence: opts?.confidence ?? "medium",
            selectedLeg: defaultRouteCompareSelection(guidanceRouteId),
            hazardLngLat,
            hazardAlongMeters: jamAlongM,
          })
        );
      } catch {
        const opened = openRouteCompareFromPlan({
          headline: compareHeadline,
          hazardLngLat,
          hazardAlongMeters: jamAlongM,
          confidence: opts?.confidence ?? "medium",
        });
        if (!opened) {
          setViewModeBeforeTrafficBypass(null);
          setTapHint("Route compare failed — try again when you have a signal.");
          window.setTimeout(() => setTapHint(null), 5000);
        }
      } finally {
        setBypassBusy(false);
      }
    },
    [
      env.mapboxToken,
      userLngLat,
      effectiveUserLngLat,
      demoBypassTrafficJamPlus,
      destLngLat,
      guidanceRoute,
      userAlongGuidanceM,
      isPlus,
      stormAlertsForRouting,
      settingStormEnabled,
      learnEnabled,
      openRouteCompareFromPlan,
      activateRouteCompare,
      guidanceRouteId,
    ]
  );

  const handleTrafficBypassFromHere = useCallback(async (opts?: {
    /** Override the jam anchor (m along route). Used by demo paths that need a deterministic point. */
    anchorAlongMeters?: number;
    /** Override the lng/lat shown for the hazard pin. Falls back to the route geometry at the anchor. */
    anchorLngLat?: LngLat;
  }) => {
    if (!TRAFFIC_BYPASS_ENABLED) return;
    if (!isPlus) return;
    const anchorImpact = opts?.anchorAlongMeters == null
      ? pickTrafficBypassAnchorImpact(routeImpactsForUi)
      : null;
    await openRouteCompareFromHere({
      headline: trafficBypassOfferHeadline(trafficBypassContext),
      anchorAlongMeters: opts?.anchorAlongMeters ?? anchorImpact?.alongMeters,
      anchorLngLat: opts?.anchorLngLat ?? anchorImpact?.lngLat,
      confidence: trafficBypassContext?.confidence ?? "medium",
    });
  }, [
    isPlus,
    routeImpactsForUi,
    trafficBypassContext,
    openRouteCompareFromHere,
  ]);

  /* Hazard sheet's "Try alternate route" CTA is only meaningful when we have Plus + Mapbox +
   * an active trip. Hoisted out of the JSX IIFE in Phase 4e4 so the render path stays declarative.
   * Placed below `handleTrafficBypassFromHere` because the handler closes over it. */
  const hazardSheetAlternateAvailable = useMemo(
    () =>
      TRAFFIC_BYPASS_ENABLED &&
      Boolean(
        isPlus &&
          env.mapboxToken &&
          userLngLat &&
          destLngLat &&
          guidanceRoute?.geometry?.length
      ),
    [isPlus, env.mapboxToken, userLngLat, destLngLat, guidanceRoute?.geometry?.length]
  );

  /** Hazard sheet → "Try alternate route": for weather corridors with no pre-built alt,
   * recompute first, then open the bypass compare; otherwise jump straight into compare. */
  const handleHazardSheetTryAlternate = useCallback(() => {
    if (!routeHazardSheet) return;
    const primary = routeHazardSheet.alerts[0];
    runAfterHazardSheetAction(() => {
      if (!hazardSheetAlternateAvailable || !guidanceRoute?.geometry?.length || !destLngLat) {
        setTapHint("Route compare needs Plus, traffic, and an active trip.");
        window.setTimeout(() => setTapHint(null), 5500);
        return;
      }
      const geom = guidanceRoute.geometry;
      let anchorAlongM: number | undefined;
      let anchorLngLat: LngLat | undefined;
      if (primary?.alongMeters != null && geom.length) {
        const totalM = polylineLengthMeters(geom);
        anchorAlongM = Math.max(0, Math.min(primary.alongMeters, totalM - 1));
        anchorLngLat = pointAtAlongMeters(geom, anchorAlongM);
      }
      const bypassOpts = { anchorAlongMeters: anchorAlongM, anchorLngLat };
      if (primary?.corridorKind === "weather" && !alternateBypassRouteId) {
        void (async () => {
          await computeRoutes(destLngLat, destinationLabel.trim() || "Destination", {
            preserveNavigation: true,
          });
          void handleTrafficBypassFromHere(bypassOpts);
        })();
        return;
      }
      void handleTrafficBypassFromHere(bypassOpts);
    });
  }, [
    routeHazardSheet,
    runAfterHazardSheetAction,
    hazardSheetAlternateAvailable,
    guidanceRoute,
    destLngLat,
    destinationLabel,
    alternateBypassRouteId,
    computeRoutes,
    handleTrafficBypassFromHere,
  ]);

  /** Stop navigation and clear the trip (single “cancel everything” control). */
  const handleStopAndClear = () => {
    clearRoute();
    setFitTrigger((n) => n + 1);
  };

  const handleSaveCurrentDestination = useCallback(() => {
    if (!destLngLat) return;
    if (!canAddPlace) {
      setTapHint("Basic limit: 2 saved places. Upgrade to Plus for more.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const name = destinationLabel.trim() || "Saved place";
    addPlace(name, destLngLat);
  }, [destLngLat, destinationLabel, addPlace, canAddPlace]);

  const handleSaveCurrentLocation = useCallback(async () => {
    if (!userLngLat) {
      setTapHint(
        locationError ?? "Turn on location first — allow it for this site in browser settings."
      );
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    if (!canAddPlace) {
      setTapHint("Basic limit: 2 saved places. Upgrade to Plus for more.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const [lng, lat] = userLngLat;
    let name = forecastPlaceShort ?? formatCoordsAreaLabel(lat, lng);
    if (!forecastPlaceShort && env.mapboxToken) {
      const hit = await mapboxReverseGeocode(lng, lat, env.mapboxToken);
      if (hit?.placeName) name = shortenPlaceNameForForecast(hit.placeName);
    }
    addPlace(name, userLngLat);
    setTapHint(`Saved place: ${name}`);
    window.setTimeout(() => setTapHint(null), 4500);
  }, [userLngLat, locationError, forecastPlaceShort, env.mapboxToken, addPlace, canAddPlace]);

  const openSaveRouteSheet = useCallback(() => {
    if (!canAddRoute) {
      setTapHint("Basic limit: 1 saved route. Upgrade to Plus for more.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const r = plan.routes.find((x) => x.id === lineFocusId) ?? plan.routes[0];
    if (!r?.geometry || r.geometry.length < 2 || !destLngLat) return;
    setPendingSave({
      kind: "route",
      geometry: r.geometry.map(([a, b]) => [a, b]),
      turnSteps: r.turnSteps,
      destinationLngLat: [...destLngLat],
      destinationLabel: destinationLabel.trim() || "Destination",
    });
  }, [plan.routes, lineFocusId, destLngLat, destinationLabel, canAddRoute]);

  const handleLoadSavedRoute = useCallback(
    (sr: SavedRoute, opts?: { reverse?: boolean }) => {
      const reverse = opts?.reverse ?? false;
      resetNavigationPlanning();
      setPlan(tripPlanFromSavedRoute(sr, { reverse }));
      const dest: LngLat = reverse
        ? [sr.geometry[0]![0], sr.geometry[0]![1]]
        : [sr.destinationLngLat[0], sr.destinationLngLat[1]];
      const label = reverse
        ? sr.startLabel?.trim() || "Start of path"
        : sr.destinationLabel;
      setDestLngLat(dest);
      setDestinationLabel(label);
      setSearchText(label);
      setSearchExpanded(false);
      setAllowAutocomplete(true);
      setRouteError(null);
      setSuggestions([]);
      setViewMode("route");
      setFitTrigger((n) => n + 1);
      setSavedDrawerOpen(false);
      setTapHint(
        reverse
          ? "Reversed path — follow the line toward the original start."
          : "Saved route on map — no new router fetch. Switch routes in Rt view with the route control."
      );
      window.setTimeout(() => setTapHint(null), 6000);
    },
    [resetNavigationPlanning]
  );

  const handleReturnToPreviousDestination = useCallback(() => {
    const leg = returnTripLeg ?? loadReturnTripLeg();
    if (!leg || leg.geometry.length < 2) {
      setTapHint("No previous trip to return to yet — start a route with Go first.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    if (!userLngLat) {
      setTapHint(
        locationError ?? "Turn on location first — allow it for this site in browser settings."
      );
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    const sr: SavedRoute = {
      id: "return-leg",
      name: "Return",
      geometry: leg.geometry,
      destinationLngLat: leg.outboundDestLngLat,
      destinationLabel: leg.outboundDestLabel,
      startLabel: leg.returnToLabel,
      createdAt: leg.savedAtMs,
    };
    handleLoadSavedRoute(sr, { reverse: true });
  }, [returnTripLeg, userLngLat, locationError, handleLoadSavedRoute]);

  const handleStartRecordingPath = useCallback(() => {
    if (!userLngLat) {
      setTapHint(locationError ?? "Turn on location to record a path.");
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    startRouteRecording(userLngLat);
    setSavedDrawerOpen(false);
  }, [userLngLat, startRouteRecording, locationError]);

  const handleStopRecordingSave = useCallback(() => {
    const geom = tryFinishRecording();
    if (!geom) {
      setTapHint("Keep driving — need ~150 ft and a few GPS points, then tap Stop & save again.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const end = geom[geom.length - 1]!;
    setRecordedSuggestName(
      `Drive · ${new Date().toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
    );
    setPendingSave({ kind: "recorded", geometry: geom, destinationLngLat: end });
  }, [tryFinishRecording]);

  const handleDiscardRecordingPath = useCallback(() => {
    discardRouteRecording();
  }, [discardRouteRecording]);

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

  const advisoryRoadDetailRows = useMemo(() => {
    const rows = [...stormRoadDetailRows];
    const betterRoute = suggestedRouteId && suggestedRouteId !== guidanceRouteId ? suggestedRouteId : null;
    /** ETA minutes comparable to {@link driveEtaMinutes}: full trip before Go; remaining while navigating. */
    const etaForRoadTrafficComparison = (routeId: string): number | null => {
      const s = scored.find((x) => x.route.id === routeId);
      if (!s) return null;
      const full = Math.round(s.effectiveEtaMinutes);
      if (!navigationStarted) return full;
      if (routeId === guidanceRouteId && driveEtaMinutes != null) return driveEtaMinutes;
      const geom = plan.routes.find((r) => r.id === routeId)?.geometry;
      if (!geom?.length || !effectiveUserLngLat) return full;
      const totalM = polylineLengthMeters(geom);
      if (totalM <= 1) return full;
      const along = Math.max(
        0,
        Math.min(totalM, closestAlongRouteMeters(effectiveUserLngLat, geom).alongMeters)
      );
      const frac = Math.max(0, totalM - along) / totalM;
      return Math.max(1, Math.round(full * frac));
    };
    const tLeg = trafficOverlay?.[guidanceRouteId];
    const hasTrafficStop = Boolean(tLeg?.nearStopFraction != null || tLeg?.hasClosure);
    const incidentLikeAlert = routeAlerts.find((a) => {
      if (a.corridorKind === "traffic" && a.id !== "traffic-delay") return true;
      if (a.corridorKind !== "hazard") return false;
      return /\b(accident|crash|incident|closure|closed|blocked|lane\s*closure|work\s*zone|construction)\b/i.test(
        `${a.title} ${a.detail}`
      );
    });

    if (hasTrafficStop) {
      rows.push({
        label: "Traffic stop",
        text: <strong>Stopped/blocked traffic detected on your route</strong>,
        actionLabel: "Show stop",
        onAction: handleInspectTrafficStop,
      });
    }
    if (incidentLikeAlert) {
      rows.push({
        label: "Traffic alert",
        text: (
          <>
            <strong>{incidentLikeAlert.detail || incidentLikeAlert.title}</strong>{" "}
            <span className="storm-advisory-bar__road-muted">— possible slowdown on route.</span>
          </>
        ),
      });
    }

    if (betterRoute) {
      const curEta = etaForRoadTrafficComparison(guidanceRouteId);
      const altEta = etaForRoadTrafficComparison(betterRoute);
      let betterRouteNote: string;
      if (curEta != null && altEta != null) {
        const deltaMin = curEta - altEta;
        if (deltaMin >= 3) {
          betterRouteNote = `may save about ${formatEtaDuration(deltaMin)}.`;
        } else if (deltaMin <= -3) {
          betterRouteNote = `about ${formatEtaDuration(-deltaMin)} longer — suggested for lower stress / fewer hazards.`;
        } else {
          betterRouteNote = "similar ETA — suggested for calmer conditions; compare A/B/C in Rt view.";
        }
      } else {
        betterRouteNote = "worth checking now.";
      }
      rows.push({
        label: "Better route",
        text: (
          <>
            <strong>{betterRoute.toUpperCase()}</strong>{" "}
            <span className="storm-advisory-bar__road-muted">{betterRouteNote}</span>
          </>
        ),
        actionLabel: TRAFFIC_BYPASS_ENABLED ? "Compare routes" : undefined,
        onAction:
          TRAFFIC_BYPASS_ENABLED &&
          isPlus &&
          env.mapboxToken &&
          userLngLat &&
          destLngLat &&
          guidanceRoute?.geometry?.length
            ? () => void handleTrafficBypassFromHere()
            : undefined,
      });
    }

    return rows;
  }, [
    stormRoadDetailRows,
    suggestedRouteId,
    guidanceRouteId,
    scored,
    trafficOverlay,
    routeAlerts,
    driveEtaMinutes,
    handleInspectTrafficStop,
    handleTrafficBypassFromHere,
    navigationStarted,
    effectiveUserLngLat,
    plan.routes,
    isPlus,
    env.mapboxToken,
    userLngLat,
    destLngLat,
    guidanceRoute?.geometry?.length,
  ]);

  /** Busy message source — debounced before advisory to avoid layout/rotator flicker. */
  const activityBusyRaw = useMemo(() => {
    const trafficBusy =
      isPlus &&
      navigationStarted &&
      plan.routes.length > 0 &&
      !trafficFetchDone &&
      settingTrafficEnabled &&
      Boolean(env.mapboxToken) &&
      isOnline;

    const stormBusy =
      stormLoading &&
      advisoryLifeSafetyOn &&
      stormCorridorAlerts.length === 0 &&
      !(stormMapGeoJson?.features?.length);

    if (routing) return "Building routes…";
    if (bypassBusy) return "Checking alternates…";
    if (suggestLoading) return "Searching…";
    if (trafficBusy) return "Loading traffic…";
    if (stormBusy) return "Loading maps & advisories…";
    return null;
  }, [
    routing,
    bypassBusy,
    suggestLoading,
    navigationStarted,
    plan.routes.length,
    trafficFetchDone,
    settingTrafficEnabled,
    env.mapboxToken,
    isOnline,
    stormLoading,
    stormCorridorAlerts.length,
    stormMapGeoJson?.features?.length,
    advisoryLifeSafetyOn,
    isPlus,
  ]);

  const [activityBusyLabel, setActivityBusyLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!activityBusyRaw) {
      const id = window.setTimeout(() => setActivityBusyLabel(null), 300);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setActivityBusyLabel(activityBusyRaw), 700);
    return () => window.clearTimeout(id);
  }, [activityBusyRaw]);

  const devPointerStyle = import.meta.env.DEV
    ? ({
        ["--sp-dev-cursor-default"]: DEV_CURSOR_DEFAULT,
        ["--sp-dev-cursor-pointer"]: DEV_CURSOR_POINTER,
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={`app-shell nav-fullmap${navigationStarted && viewMode === "drive" ? " nav-drive-ui" : ""}${
        navigationStarted && viewMode === "topdown" ? " nav-mapnav-ui" : ""
      }${showProgressRail ? " nav-progress-rail-on" : ""
      }${trafficBypassCompare ? " nav-route-compare-active" : ""
      }${basemapNight ? " app-shell--basemap-night" : ""}${settingLandscapeSideHand === "left" ? " app-shell--landscape-hand-left" : ""}${
        radarMapOverlayOn && radarFrameUtcSec != null ? " nav-radar-frame-time-visible" : ""
      }${basicAdBanner.reservesBottomSpace ? " app-shell--basic-ad-banner" : ""}${
        import.meta.env.DEV ? " app-shell--dev-pointer" : ""
      }`}
      style={devPointerStyle}
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
      <div className="map-stage map-bleed">
        <div className="map-canvas">
          <Suspense fallback={<div className="drive-map" />}>
          <DriveMap
            routes={driveMapRoutesForMap}
            lineFocusId={driveMapLineFocusId}
            suggestedRouteId={suggestedRouteId}
            userLngLat={effectiveUserLngLat}
            liveGpsLngLatRef={navigationStarted ? liveLngLatRef : undefined}
            liveGpsSpeedMpsRef={navigationStarted ? liveSpeedMpsRef : undefined}
            liveGpsHeadingRef={navigationStarted ? liveHeadingRef : undefined}
            destLngLat={destLngLat}
            viaStops={viaStops}
            fitTrigger={fitTrigger}
            viewMode={viewMode}
            navigationStarted={navigationStarted}
            heading={heading}
            driveRouteBearingDeg={driveRouteBearingDeg}
            speedMps={speedMps}
            allowDestinationPick={allowDestinationPick}
            topdownZoomRef={topdownZoomRef}
            onMapClick={handleMapClick}
            savedPlaces={savedPlaces}
            savedPlacesVisible={showOnMap}
            onSavedPlaceClick={handleSavedMarkerClick}
            mapFocus={mapFocus}
            onMapFocusComplete={flushMapFocus}
            orderedRouteIds={orderedRouteIds}
            showRadar={radarMapOverlayOn}
            radarAnimate={!dataSaverMode && (!navMapLiteMode || radarMapOverlayOn)}
            onRadarFrameUtcSec={setRadarFrameUtcSec}
            alongRouteAlerts={mapAlongRouteAlertsForDrive}
            corridorRouteGeometry={guidanceRoute?.geometry}
            stormAlongRouteBands={mapStormAlongRouteBandsForDrive}
            recordingGeometry={recordingActive ? recordingPathPreview : undefined}
            weatherAlertGeoJson={deferredNwsAlertGeoJsonForMap}
            stormBarVisible={showStormAdvisoryChrome}
            stormBarExpanded={stormBarExpanded}
            recenterPlanningPuckTick={recenterPlanningPuckTick}
            puckSnapGeometry={
              navigationStarted && guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2
                ? guidanceRoute.geometry
                : null
            }
            snapSeedMeters={
              Number.isFinite(userAlongGuidanceM) && (userAlongGuidanceM ?? 0) >= 0
                ? userAlongGuidanceM
                : null
            }
            userAlongMeters={
              navigationStarted && Number.isFinite(userAlongGuidanceM) ? userAlongGuidanceM : null
            }
            trafficConditionsOnMap={Boolean(
              isPlus &&
                roadAdvisoryDetailOn &&
                settingTrafficEnabled &&
                Boolean(env.mapboxToken)
            )}
            onDriveCameraBearingDeg={handleDriveCameraBearingDeg}
            stormBrowseBoundsReporting={false}
            onStormBrowseBoundsChange={undefined}
            trafficBypassCompareActive={Boolean(trafficBypassCompare)}
            trafficBypassCompareHazardLngLat={trafficBypassCompare?.hazardLngLat ?? null}
            trafficBypassCompareHazardAlongMeters={trafficBypassCompare?.hazardAlongMeters ?? null}
            rejoinCompareLockedRouteId={lockedNavigationRouteId}
            activityTrailGeoJson={activityTrailGeoJsonForMap}
            sessionRouteLengthM={
              guidanceRouteLengthM > 0 ? guidanceRouteLengthM : maxPlanRouteLengthM
            }
            activityTrailPlanningBounds={activityTrailPlanningBounds}
            idleHomeMapFraming={idleHomeMapFraming}
            homePuckFollow={homePuckFollow}
            onHomeMapUserPan={() => {
              if (plan.routes.length === 0 && !navigationStarted) {
                setHomePuckFollow("explore");
              }
            }}
            homePreloadEnabled={isPlus && learnEnabled && homePreloadEnabled}
            homePreloadBounds={homePreloadBounds}
            searchPickMarkers={searchPickMarkersForMap}
            onSearchPickMarkerClick={searchPickMarkersForMap ? handleSearchPickFromMap : undefined}
            progressRailVisible={showProgressRail}
          />
          </Suspense>
        </div>

        <div className="nav-drive-overlay-stack">
            {!trafficBypassCompare ? (
            <div className="nav-top-cluster">
              <div className="nav-top-route-rail">
                <div className="nav-top-route-rail__main">
                  <TopGuidanceBar
                    hasRoute={navigationStarted && plan.routes.length > 0}
                    turnSteps={turnSteps}
                    activeTurnIndex={bannerTurnIndex}
                    metersToManeuverEnd={metersToBannerManeuver}
                    glanceable={navigationStarted && viewMode === "drive"}
                  />
                  {showStormAdvisoryChrome ? (
                    <StormAdvisoryBar
                      featureEnabled
                      sessionOn={stormSessionOn}
                      onSessionToggle={onStormSessionToggle}
                      loading={
                        isPlus &&
                        stormLoading &&
                        stormCorridorAlerts.length === 0 &&
                        !(stormMapGeoJson?.features?.length)
                      }
                      error={isPlus ? stormError : null}
                      corridorAlerts={isPlus ? allDisplayableAlerts : []}
                      overlappingAlerts={isPlus ? nwsAlertsForGuidanceAdvisory : []}
                      nwsAtLocationAlerts={isPlus ? stormNwsPuckInside : []}
                      trafficDelayMinutes={guidanceSlice?.trafficDelayMinutes ?? 0}
                      onTrafficReroute={
                        TRAFFIC_BYPASS_ENABLED &&
                        isPlus &&
                        env.mapboxToken &&
                        userLngLat &&
                        destLngLat &&
                        guidanceRoute &&
                        showTrafficBypassCta
                          ? () => void handleTrafficBypassFromHere()
                          : undefined
                      }
                      trafficRerouteBusy={bypassBusy}
                      roadDetailEnabled={isPlus && roadAdvisoryDetailOn}
                      onRoadDetailToggle={onRoadAdvisoryDetailToggle}
                      hasGuidanceRoute={Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2)}
                      roadDetailRows={isPlus ? advisoryRoadDetailRows : []}
                      routeImpacts={isPlus ? advisoryRouteImpacts : null}
                      stormStripBands={isPlus ? advisoryStormStripBands : null}
                      routeAheadTimeline={isPlus ? routeAheadTimeline : null}
                      routeTotalMeters={guidanceRouteLengthM}
                      userAlongMeters={advisoryUserAlongM}
                      planEtaMinutes={guidanceRoute?.baseEtaMinutes ?? null}
                      driveEtaMinutes={driveEtaMinutes ?? null}
                      barExpanded={stormBarExpanded}
                      onBarExpandedChange={onStormBarExpandedChange}
                      hideHeadToggles={!isPlus}
                      onNwsAlertClick={handleAdvisoryNwsClick}
                      busyLabel={activityBusyLabel}
                      staleWeatherNote={routeForecastRefreshBlocked}
                      onRefreshWeather={handleRefreshRouteInfoWeather}
                      driveRouteAheadLine={driveModeUi ? driveRouteAheadLine : null}
                      advisoryTier={advisoryPlusDetailOn ? "plus" : "basic"}
                      ownsPlus={isPlus}
                      promoLines={advisoryPromoLines}
                      isOnline={isOnline}
                      basicNavAdvisoryMode={!isPlus}
                      navigationStarted={navigationStarted}
                      nowcastLine={isPlus ? advisoryNowcastLine : null}
                      currentNowcast={isPlus ? currentNowcast : null}
                      forecastAreaLabel={isPlus ? forecastAreaLabel : null}
                      minutePrecipForecast={isPlus ? tioMinutePrecip : null}
                      hourlyForecast={isPlus ? localHourlyForecast : null}
                      localForecastNwsAlerts={isPlus ? localForecastNwsAlerts : []}
                      nwsForecastLoading={
                        isPlus &&
                        stormLoading &&
                        stormCorridorAlerts.length === 0 &&
                        !(stormMapGeoJson?.features?.length)
                      }
                      nwsForecastError={isPlus ? stormError : null}
                      basicForecastLoading={isPlus ? localForecastPanelLoading : false}
                      onOpenSubscription={() => setAboutOpen(true)}
                      basicStatusPanelPromos={basicStatusPanelPromos}
                      dataSaverHint={
                        showDataSaverHint
                          ? {
                              onOpenSettings: () => setAboutOpen(true),
                              onDismiss: () => {
                                /* Store action: persists + flips `dataSaverHintDismissed` in one go. */
                                dismissDataSaverHintAction();
                              },
                            }
                          : null
                      }
                    />
                  ) : isPlus ? (
                    <div className="nav-top-activity-pill-wrap nav-top-activity-pill-wrap--solo">
                      <ActivityStatusPill busyLabel={activityBusyLabel} />
                    </div>
                  ) : null}
                  {radarMapOverlayOn && radarFrameClockLabel ? (
                    <div
                      className="map-radar-frame-time-cluster"
                      aria-live="polite"
                      title="Radar mosaic time (local)"
                    >
                      {radarFrameClockLabel}
                    </div>
                  ) : null}
                  {hazardApproachAlertsActive && driveApproachBannerPick ? (
                    <DriveHazardApproachBanner
                      phase={driveApproachBannerPick.phase}
                      impact={driveApproachBannerPick.impact}
                      rerouteEnabled={
                        TRAFFIC_BYPASS_ENABLED &&
                        (showTrafficBypassCta ||
                          driveApproachBannerPick.impact.id === "demo-approach-banner" ||
                          driveApproachBannerPick.impact.id === "demo-close-hazard")
                      }
                      onDismiss={() => {
                        const id = driveApproachBannerPick.impact.id;
                        if (id === "demo-approach-banner") {
                          setDemoApproachBannerOn(false);
                          return;
                        }
                        if (id === "demo-close-hazard") {
                          setDemoCloseHazardOn(false);
                          return;
                        }
                        const key = driveApproachBannerPick.phase === "early" ? `e:${id}` : `n:${id}`;
                        setDriveApproachDismissedIds((prev) => new Set(prev).add(key));
                      }}
                      onPlanAround={() => {
                        const id = driveApproachBannerPick.impact.id;
                        if (id === "demo-approach-banner") {
                          setDemoApproachBannerOn(false);
                          openDemoTrafficBypassCompareMock();
                          return;
                        }
                        /* Close-hazard demo runs the *real* bypass pipeline against the live route so
                         * we can validate the adaptive next-exit window end-to-end (not the mock compare).
                         * We pass the demo impact's anchor explicitly because it isn't in routeImpactsForUi. */
                        if (id === "demo-close-hazard") {
                          const closeAnchor = driveApproachBannerPick.impact.alongMeters;
                          const closeLngLat = driveApproachBannerPick.impact.lngLat;
                          setDemoCloseHazardOn(false);
                          void handleTrafficBypassFromHere({
                            anchorAlongMeters: closeAnchor,
                            anchorLngLat: closeLngLat,
                          });
                          return;
                        }
                        void handleTrafficBypassFromHere();
                      }}
                      busy={bypassBusy}
                    />
                  ) : null}
                </div>
              </div>
            </div>
            ) : null}
            {showProgressRail && (
              <div
                className={`nav-route-progress-rail${progressCalloutsOpen && progressCalloutCount > 0 ? " nav-route-progress-rail--callouts-open" : ""}`}
              >
                <div className="nav-route-progress-rail__inner">
                  <RouteProgressCalloutRail
                    open={progressCalloutsOpen}
                    onOpenChange={setProgressCalloutsOpen}
                    hasContent={progressCalloutCount > 0}
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
                    refreshBusy={routeInfoWeatherRefreshing}
                    refreshNote={routeForecastRefreshBlocked}
                    refreshNoteTone={
                      routeForecastUsingCache && routeForecastRefreshBlocked ? "info" : "warn"
                    }
                    onRefresh={handleRefreshRouteInfoWeather}
                  >
                    <RouteProgressGlancePanel
                      timeline={routeAheadTimeline}
                      routeWide={activeProgressCalloutPanel.routeWide}
                      outlookSteps={activeProgressCalloutPanel.outlookTimeline}
                      outlookSamples={activeProgressCalloutPanel.outlookSamples}
                      radarSamples={radarMosaicAlongRoute.samples}
                      windPoints={activeProgressCalloutPanel.windPoints}
                      gustSpikePoints={activeProgressCalloutPanel.gustSpikePoints}
                      fallbackSegments={activeProgressCalloutPanel.segments.filter(
                        (s) => !s.key.startsWith("route-ahead-")
                      )}
                      totalMeters={guidanceRouteLengthM}
                      userAlongMeters={progressPanelAlongM}
                      planEtaMinutes={guidanceRoute?.baseEtaMinutes ?? null}
                      driveEtaMinutes={driveEtaMinutes ?? null}
                      userAlongT={progressCalloutUserAlongT}
                      stripTint={activeProgressCalloutPanel.stripTint}
                      detailScrollRef={progressCalloutDetailScrollRef}
                    />
                  </RouteProgressCalloutRail>
                  <RouteProgressStrip
                    layout="side"
                    geometry={progressRailRoute!.geometry}
                    userLngLat={effectiveUserLngLat}
                    userAlongMeters={userAlongGuidanceM}
                    alerts={progressStripAlerts}
                    radarIntensity={guidanceSlice?.radarIntensity ?? 0}
                    routeLineColor={progressStripRouteColor}
                    turnSteps={progressRailRoute!.turnSteps ?? turnSteps}
                    stormBands={routeAheadProgressBands}
                    driveEndsEmphasis={driveModeUi}
                    tripOdometerM={tripOdometerM}
                    tripRelativeProgress={navigationStarted}
                    routeInfoOpen={progressCalloutsOpen}
                    onRouteInfoOpenChange={
                      progressCalloutCount > 0 ? setProgressCalloutsOpen : undefined
                    }
                  />
                </div>
              </div>
            )}
          </div>

        {routeHazardSheet && (
          <RouteHazardSheet
            open
            alerts={routeHazardSheet.alerts}
            alternateRouteAvailable={hazardSheetAlternateAvailable}
            bypassBusy={bypassBusy}
            onClose={() => setRouteHazardSheet(null)}
            onTryAlternateRoute={handleHazardSheetTryAlternate}
          />
        )}

        <TollFlowSheets
          avoidFailureNote={tollAvoidFailureNote}
          busy={tollAvoidBusy || routing}
          onContinue={handleTollContinue}
          onPreview={() => void handleTollPreview()}
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

        {pendingSave?.kind === "route" && (
          <NameConfirmSheet
            title="Save route"
            initialName={`${pendingSave.destinationLabel} · route`}
            hint="Restores this line on the map without calling the router again."
            confirmLabel="Save route"
            onConfirm={(name) => {
              addSavedTripRoute(
                name,
                pendingSave.destinationLngLat,
                pendingSave.destinationLabel,
                pendingSave.geometry,
                pendingSave.turnSteps
              );
              setPendingSave(null);
              setTapHint("Route saved — ★ → Routes → Use.");
              window.setTimeout(() => setTapHint(null), 4000);
            }}
            onCancel={() => setPendingSave(null)}
          />
        )}
        {pendingSave?.kind === "recorded" && (
          <NameConfirmSheet
            title="Save recorded path"
            initialName={recordedSuggestName}
            hint="GPS trace — no turn-by-turn from the router. Ends are labeled so you can run the path forward or reversed later (★ → Routes)."
            confirmLabel="Save route"
            onConfirm={(name) => {
              addSavedTripRoute(
                name,
                pendingSave.destinationLngLat,
                recordedEndLabel.trim() || "Recorded destination",
                pendingSave.geometry,
                undefined,
                recordedStartLabel.trim() || undefined
              );
              setPendingSave(null);
              setTapHint("Recorded route saved — ★ → Routes → Use.");
              window.setTimeout(() => setTapHint(null), 4000);
            }}
            onCancel={() => setPendingSave(null)}
          />
        )}
        {pendingSave?.kind === "learned" && (
          <NameConfirmSheet
            title="Save frequent route"
            initialName={`Commute · ${pendingSave.cluster.count}×`}
            hint="From Plus trip learning — same polyline behavior as other saved routes (no new router fetch)."
            confirmLabel="Save route"
            onConfirm={(name) => {
              const c = pendingSave.cluster;
              const end = c.geometry[c.geometry.length - 1]!;
              addSavedTripRoute(name, end, "Learned destination", c.geometry, undefined);
              dismissCluster(c.id);
              setPendingSave(null);
              setTapHint("Frequent route saved — ★ → Routes → Use.");
              window.setTimeout(() => setTapHint(null), 4000);
            }}
            onCancel={() => setPendingSave(null)}
          />
        )}

        {!env.mapboxToken && (
          <div className="nav-toast nav-toast-warn" role="status">
            {typeof window !== "undefined" && window.location.hostname.includes("netlify.app")
              ? "Map unavailable — add VITE_MAPBOX_TOKEN in Netlify env vars (Builds scope), then redeploy."
              : "Add VITE_MAPBOX_TOKEN in web/.env.local."}
          </div>
        )}

        {import.meta.env.DEV && devLocOverrideLngLat && (
          <div className="nav-toast nav-toast-warn" role="status">
            <strong>Dev pinned location</strong> — the browser never asks for GPS.{" "}
            <button
              type="button"
              className="nav-toast-inline-btn"
              onClick={() => {
                clearDevLocationOverride();
                window.location.hash = "";
                window.location.reload();
              }}
            >
              Use real GPS
            </button>
          </div>
        )}

        {import.meta.env.DEV && locationFixSource === "dev-ip" && (
          <div className="nav-toast nav-toast-warn" role="status">
            <strong>Approximate dev position (ISP / metro)</strong> — not GPS. Open{" "}
            <code>http://localhost:5173</code> on this computer, or use the native app, for a real fix.
          </div>
        )}

        {locationError && (
          <div className="nav-toast nav-toast-err" role="alert">
            {locationError}
          </div>
        )}

        {tapHint && (
          <div className="nav-toast nav-toast-warn" role="status">
            {tapHint}
          </div>
        )}

        {routeError && (
          <div className="nav-toast nav-toast-err" role="alert">
            {routeError}
          </div>
        )}

        {!safetyAck && (
          <div className="nav-safety-banner" role="dialog" aria-label="Safety notice">
            <div className="nav-safety-banner__text">
              Do not use StormPath while driving. Use a passenger or pull over. Always follow official warnings and road
              closures.
            </div>
            <div className="nav-safety-banner__actions">
              {env.supportEmail || env.supportUrl ? (
                <button type="button" className="nav-safety-banner__btn nav-safety-banner__btn--ghost" onClick={handleQuickReportIssue}>
                  Report issue
                </button>
              ) : null}
              <button
                type="button"
                className="nav-safety-banner__btn"
                onClick={() => {
                  safeStorage.set("stormpath-safety-ack-v1", "1");
                  setSafetyAck(true);
                }}
              >
                OK
              </button>
            </div>
          </div>
        )}

        {!isOnline && (navigationStarted || plan.routes.length > 0 || Boolean(destLngLat)) && (
          <div
            className={`nav-offline-banner${driveModeUi ? " nav-offline-banner--drive" : ""}`}
            role="status"
            aria-live="polite"
          >
            {driveModeUi
              ? isPlus
                ? "Offline — cached route; no live traffic, weather, or storm updates."
                : "Offline — cached route; map and radar may be limited until you reconnect."
              : isPlus
                ? "Offline — showing last route. Live updates paused (traffic, weather, storm). See About if layers stay empty after you reconnect."
                : "Offline — showing last route. Reconnect for map tiles and radar. See About if layers stay empty."}
          </div>
        )}

        {demoBypassTrafficJamPlus && driveModeUi && navigationStarted && (
          <div className="nav-demo-bypass-banner" role="region" aria-label="Plus traffic bypass demo tools">
            <div className="nav-demo-bypass-banner__top">
              <span className="nav-demo-bypass-banner__short">Demo</span>
              <div className="nav-demo-bypass-banner__actions">
                <button type="button" className="nav-demo-bypass-banner__btn" onClick={toggleDemoPlaybackPlaying}>
                  {demoPlaybackPlaying ? "Pause" : "Play"}
                </button>
                <button type="button" className="nav-demo-bypass-banner__btn" onClick={resetDemoPlaybackAlongRoute}>
                  Reset puck
                </button>
                <button
                  type="button"
                  className="nav-demo-bypass-banner__btn"
                  onClick={() => {
                    setDemoApproachBannerOn((v) => !v);
                    if (demoCloseHazardOn) setDemoCloseHazardOn(false);
                  }}
                  disabled={Boolean(trafficBypassCompare)}
                >
                  {demoApproachBannerOn && !demoCloseHazardOn ? "Hide banner" : "Mock banner"}
                </button>
                <button
                  type="button"
                  className="nav-demo-bypass-banner__btn"
                  onClick={() => {
                    setDemoCloseHazardOn((v) => !v);
                    if (demoApproachBannerOn) setDemoApproachBannerOn(false);
                  }}
                  disabled={Boolean(trafficBypassCompare)}
                >
                  {demoCloseHazardOn ? "Hide close" : "Mock close hazard"}
                </button>
                <button
                  type="button"
                  className="nav-demo-bypass-banner__btn"
                  onClick={openDemoTrafficBypassCompareMock}
                  disabled={Boolean(trafficBypassCompare)}
                >
                  Mock compare
                </button>
              </div>
            </div>
            <details className="nav-demo-bypass-banner__details">
              <summary className="nav-demo-bypass-banner__summary">Demo notes</summary>
              <div className="nav-demo-bypass-banner__text">
                URL flag <code>?demo=bypass</code>. <strong>Play</strong> moves the puck at estimated MPH from turn text.{" "}
                <strong>Mock banner</strong> shows the approach strip with a fake impact ~1.4 mi ahead — tap it to jump
                to the mock compare. <strong>Mock close hazard</strong> drops one ~0.6 mi ahead so the surgical bypass
                runs in its <em>next-exit</em> tier (tighter exit/rejoin window). <strong>Mock compare</strong> opens
                the A/B/C panel directly (no Mapbox call).
              </div>
            </details>
          </div>
        )}

        <div className="nav-bottom-stack">
          <RouteCompareBottomPanel
            onSelect={handleTrafficBypassCompareSelect}
            onConfirm={handleTrafficBypassCompareConfirm}
            onCancel={handleTrafficBypassCompareCancel}
          />

          {recordingActive && !trafficBypassCompare ? (
            <RecordingRouteBanner
              pointCount={recordingPointCount}
              lengthMeters={recordingLengthM}
              onStopSave={handleStopRecordingSave}
              onDiscard={handleDiscardRecordingPath}
            />
          ) : null}
          {!trafficBypassCompare ? (
          <div className="nav-bottom-chrome-wrap">
            <div className="nav-bottom-dock">
              {navigationStarted && viewMode === "drive" ? (
                <div className="nav-bottom-dock__about-row">
                  <div className="nav-bottom-dock__drive-about-cluster">
                    <div className="nav-bottom-dock__compass-i-col">
                      <DriveCompass bearingDeg={driveMapBearingDeg} />
                      <button
                        type="button"
                        className="map-about-btn"
                        aria-label="About StormPath"
                        title="About / Settings"
                        onClick={() => setAboutOpen(true)}
                      >
                        i
                      </button>
                    </div>
                    {driveDistanceRemainingLabel ? (
                      <NavMilesLeftBox label={driveDistanceRemainingLabel} />
                    ) : null}
                  </div>
                </div>
              ) : navigationStarted && viewMode === "topdown" ? (
                <div className="nav-bottom-dock__about-row">
                  <button
                    type="button"
                    className="map-about-btn"
                    aria-label="About StormPath"
                    title="About / Settings"
                    onClick={() => setAboutOpen(true)}
                  >
                    i
                  </button>
                  {driveDistanceRemainingLabel ? (
                    <NavMilesLeftBox label={driveDistanceRemainingLabel} />
                  ) : null}
                  {routePickItems.length >= 1 ? (
                    <div className="nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline">
                      <RouteCycleButton
                        items={routePickItems}
                        selectedId={lineFocusId}
                        cycleOrderIds={planRouteIds}
                        activeSlotIndex={previewLegIndex}
                        onSelect={handlePreviewRouteSelect}
                        detail={routeDockDetail}
                      />
                    </div>
                  ) : radarMapOverlayOn && radarFrameTimeLabel ? (
                    <div
                      className="nav-radar-frame-time-dock"
                      aria-live="polite"
                      title="Radar mosaic time (your local time)"
                    >
                      {radarFrameTimeLabel}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="nav-bottom-dock__plan-stack">
                  {/* About row hosts the round 'i' info button on the left and, when there are
                   * routes to cycle, the route-select button inline to its right. The route-select
                   * button is sized to fit the strip between the 'i' and the dock's right edge —
                   * which is itself flush against the vertical progress rail — so adding the
                   * select button doesn't push the rail narrower. */}
                  {/* About row hosts the round 'i' info button on the left, plus an inline
                   * action slot to its right. The slot shows route-select while a route is
                   * loaded, or "My location" while planning (no routes yet). Both share the
                   * same height + right inset so the dock keeps a single horizontal control
                   * strip clear of the vertical progress rail. */}
                  <div className="nav-bottom-dock__about-row">
                    <button
                      type="button"
                      className="map-about-btn"
                      aria-label="About StormPath"
                      title="About / Settings"
                      onClick={() => setAboutOpen(true)}
                    >
                      i
                    </button>
                    {navigationStarted && driveDistanceRemainingLabel ? (
                      <NavMilesLeftBox label={driveDistanceRemainingLabel} />
                    ) : null}
                    {viewMode === "route" && routePickItems.length >= 1 ? (
                      <div className="nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline">
                        <RouteCycleButton
                          items={routePickItems}
                          selectedId={lineFocusId}
                          cycleOrderIds={planRouteIds}
                          activeSlotIndex={previewLegIndex}
                          onSelect={handlePreviewRouteSelect}
                          detail={routeDockDetail}
                        />
                      </div>
                    ) : (viewMode === "route" || viewMode === "topdown") &&
                      plan.routes.length === 0 &&
                      userLngLat ? (
                      <button
                        type="button"
                        className="nav-recenter-puck-btn nav-recenter-puck-btn--dock nav-recenter-puck-btn--inline"
                        title="Center map on your location"
                        aria-label="Center map on your location"
                        onClick={() => {
                          setHomePuckFollow("follow");
                          setRecenterPlanningPuckTick((n) => n + 1);
                        }}
                      >
                        My location
                      </button>
                    ) : radarMapOverlayOn && radarFrameTimeLabel ? (
                      <div
                        className="nav-radar-frame-time-dock"
                        aria-live="polite"
                        title="Radar mosaic time (your local time)"
                      >
                        {radarFrameTimeLabel}
                      </div>
                    ) : null}
                  </div>
                  <div className="nav-bottom-dock__search-myloc-row">
                    <div className="nav-bottom-dock__search-col">
                      <div className="nav-search-dock">
                        {showCompactDest ? (
                          <button
                            type="button"
                            className="nav-dest-compact nav-dest-compact--tap"
                            onClick={handleCompactDestOpen}
                          >
                            <span className="nav-dest-compact-label" title={destinationLabel}>
                              {destinationLabel || "Destination"}
                            </span>
                          </button>
                        ) : (
                          <>
                            <SearchBar
                              value={searchText}
                              onChange={(v) => {
                                setSearchText(v);
                                if (plan.routes.length === 0 || searchExpanded) setAllowAutocomplete(true);
                              }}
                              onBeginEditing={handleSearchFieldBeginEditing}
                              onEndEditing={handleSearchFieldEndEditing}
                              onCancelSuggestions={handleSearchCancelSuggestions}
                              onDismiss={handleSearchDismiss}
                              onSearch={() => void handleSearch()}
                              placeholder={
                                addingViaStop && destLngLat ? "Search your stop" : "Search address or place"
                              }
                              suggestions={suggestions}
                              onPickSuggestion={(h) => void handlePickSuggestion(h)}
                              suggestionsLoading={suggestLoading}
                              showSuggestionsWhenEmpty={isNarrowPhoneViewport()}
                              enableSuggestions={allowAutocomplete && (!routeActive || searchExpanded)}
                            />
                            {!navigationStarted ? (
                              <RouteStopsBar
                                viaStops={viaStops}
                                addingStop={addingViaStop}
                                canAddStop={Boolean(destLngLat)}
                                onStartAddStop={() => setAddingViaStop(true)}
                                onCancelAddStop={() => setAddingViaStop(false)}
                                onRemoveStop={handleRemoveViaStop}
                              />
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Action row removed — both "My location" (planning) and the route-cycle
                   * button (route loaded) now live inline on the about-row above the search. */}
                </div>
              )}
            </div>

            <BottomToolbar
              viewMode={viewMode}
              onViewMode={handleViewModeChange}
              onOpenSaved={() => setSavedDrawerOpen(true)}
              navigationStarted={navigationStarted}
              onGo={handleGo}
              showGo={Boolean(plan.routes.length > 0 && primaryRouteId && !navigationStarted)}
              speedMph={speedMph}
              postedMph={postedMph}
              onStop={handleStopAndClear}
              hasTrip={Boolean(plan.routes.length > 0 || destLngLat)}
              showReturnTripButton={showReturnTripButton}
              returnTripLabel={returnTripButtonLabel}
              returnTripTitle={
                returnTripLeg
                  ? `Return to ${returnTripLeg.returnToLabel} on your previous route (reversed)`
                  : undefined
              }
              onReturnTrip={handleReturnToPreviousDestination}
              showSavedPlacesButton={
                mapPlanningUi &&
                (!navigationStarted || !routeActive)
              }
              showViewCycleButton
              viewCycleDisabled={!navigationStarted}
              driveEtaMinutes={driveEtaMinutes}
              showRadar={radarMapOverlayOn}
              onToggleRadar={() => setShowRadar((v) => !v)}
              radarEnabled={settingRadarEnabled}
              showRadarButton={!driveModeUi}
              showOffRouteBanner={showOffRouteStatusBanner}
              offRouteRejoinActive={detourAutoActive}
              offRouteRejoinDistanceLabel={detourRejoinDistanceLabel}
              offRouteOptionsBusy={routing}
              onStayOnThisRoad={() => void stayOnThisRoad()}
              onReturnToOriginalRoute={returnToOriginalRoute}
              showTrafficBypass={showTrafficBypassCta}
              bypassBusy={bypassBusy}
              onTrafficBypass={
                TRAFFIC_BYPASS_ENABLED ? () => void handleTrafficBypassFromHere() : undefined
              }
            />
          </div>
          ) : null}
        </div>
      </div>

      <Suspense fallback={null}>
        <AboutSheet
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        payTierProbeKey={payTierProbeKey}
        onPayTierOverride={
          import.meta.env.DEV || payTierTestPanelEnabled() ? reprobePayTier : undefined
        }
        activityTrail={activityTrailAboutPanel}
        homePuckFollow={homePuckFollow}
        onHomePuckFollowChange={(mode) => {
          setHomePuckFollow(mode);
          writeHomePuckFollow(mode);
          if (mode === "follow") setRecenterPlanningPuckTick((n) => n + 1);
        }}
        settings={{
          radarEnabled: settingRadarEnabled,
          stormEnabled: settingStormEnabled,
          trafficEnabled: settingTrafficEnabled,
          weatherHintsEnabled: settingWeatherHintsEnabled,
          dataSaverEnabled: settingDataSaverEnabled,
          autoRerouteEnabled: settingAutoRerouteEnabled,
          voiceGuidanceEnabled: settingVoiceGuidanceEnabled,
          gpsHighRefreshEnabled: settingGpsHighRefreshEnabled,
          mapMatchingEnabled: settingMapMatchingEnabled,
          landscapeSideHand: settingLandscapeSideHand,
        }}
        onSettings={(next) => {
          /* `applySettings` persists every field through the same helpers the individual
           * setters use and batches the state update into a single React re-render. The
           * `useEffect([settingRadarEnabled])` at the top of this file picks up the radar
           * overlay clean-up on the next tick. */
          applySettings(next);
          setTapHint(`Settings updated (${tierLabel}).`);
          window.setTimeout(() => setTapHint(null), 2500);
        }}
        onReplayCoachmarks={handleReplayCoachmarks}
        liveRerouteEnabled
        />
      </Suspense>

      <Coachmarks replayKey={coachmarksReplayKey} />
    </div>
  );
}
