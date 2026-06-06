import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { useTurnVoiceGuidance } from "./hooks/useTurnVoiceGuidance";
import { useSessionOdometerMeters } from "./hooks/useSessionOdometerMeters";
import {
  useUserLocation,
  getDevLocationOverrideLngLat,
  clearDevLocationOverride,
} from "./hooks/useUserLocation";
import { useRadarBandsAlongRoute } from "./hooks/useRadarBandsAlongRoute";
import {
  useLocalHourlyForecast,
  useTomorrowMinutePrecip,
  useTomorrowRouteForecast,
} from "./hooks/useTomorrowWeather";
import { routeForecastToImpacts } from "./nav/tomorrowIoImpacts";
import { buildMockTripBetween, EMPTY_TRIP } from "./nav/emptyTrip";
import { mergePlanPreservingPrimary } from "./nav/mergePlanRoutes";
import {
  hasAdaptiveStormThreatAlongTrip,
  stormAdaptiveRoutingSignature,
} from "./nav/stormAvoidanceWaypoint";
import { tripPlanFromSavedRoute } from "./nav/planFromSavedRoute";
import {
  isGenericOriginLabel,
  loadReturnTripLeg,
  persistReturnTripLegOnGo,
  shortenReturnTripLabel,
  type ReturnTripLeg,
} from "./nav/returnTripLeg";
import type { SavedRoute } from "./nav/savedRoutes";
import type { LngLat, TripPlan } from "./nav/types";
import { pickSuggestedActive, scoreTrip } from "./scoring/scoreRoutes";
import { buildTripFromMapbox, collectMapboxRouteVariants } from "./services/mapboxDirectionsRouter";
import { useAppForeground } from "./hooks/useAppForeground";
import { isAbortError, routeFetchUserMessage } from "./utils/fetchResilient";
import { formatDistanceShort, useMilesForLngLat } from "./utils/formatDistance";
import { useTollPreview } from "./nav/useTollPreview";
import {
  getNavAltRefreshMs,
  getNwsPollIntervalMs,
  getTrafficPollIntervalMs,
  isDataSaverMode,
} from "./utils/dataSaver";
import {
  formatCoordsAreaLabel,
  shortenPlaceNameForForecast,
} from "./utils/forecastDisplay";
import {
  mapboxAutocomplete,
  mapboxGeocodeSearch,
  mapboxReverseGeocode,
} from "./services/mapboxGeocode";
import { geocodeCountriesForFix } from "./services/continents";
import {
  mapboxSearchBoxSuggest,
  mapboxSearchBoxRetrieve,
  mintSearchBoxSessionToken,
} from "./services/mapboxSearchBox";
import {
  fetchMapboxTrafficAlongPolyline,
  trafficCongestionAnchorFraction,
} from "./services/mapboxDirectionsTraffic";
import { fetchMapboxDrivingTrafficRoute } from "./services/mapboxRouteAlternatives";
import {
  fetchCurrentNowcast,
  formatNowcastLine,
  isOpenWeatherRateLimited,
  weatherForecastAlongRoute,
  weatherHintSamplesAlongPolyline,
  type CurrentNowcast,
} from "./services/openWeatherClient";
import { formatMinutePrecipNowLine } from "./utils/forecastDisplay";
import type { RouteAlert } from "./nav/routeAlerts";
import { augmentAlertsForProgressStrip } from "./nav/routeAlerts";
import {
  buildRouteImpacts,
  routeImpactToRouteAlert,
  type RouteImpact,
} from "./nav/routeImpacts";
import { buildSimpleCalloutBlock } from "./nav/progressCalloutCopy";
import {
  buildRouteChunkCalloutList,
  type RouteChunkCalloutItem,
} from "./nav/routeProgressChunkList";
import type { RouteOutlookStep } from "./nav/routeForecastTimeline";
import { layoutStripAlerts } from "./nav/stripAlertLayout";
import {
  bearingAlongRouteAhead,
  closestAlongRouteMeters,
  haversineMeters,
  initialBearingDegrees,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./nav/routeGeometry";
import { bannerPrimaryStepIndex } from "./nav/bannerPrimaryStep";
import {
  measureOffRouteLateral,
  OFF_ROUTE_POLL_MS,
  OFF_ROUTE_REROUTE_THROTTLE_MS,
  shouldTriggerOffRouteReroute,
  shouldExitOffRouteLatch,
} from "./nav/offRouteDetect";
import { useAlongRouteMetersHeldWhenOffLine } from "./nav/guidanceAlongHold";
import {
  auditTripNavDisplay,
  computeRemainingDistanceMeters,
  computeRemainingDriveEtaMinutes,
  repairActionsForIssues,
  TRIP_NAV_DISPLAY_POLL_MS,
  TRIP_NAV_DISPLAY_REPAIR_COOLDOWN_MS,
} from "./nav/tripNavDisplay";
import { reportAppHealthRepair } from "./monitoring/appHealthSignals";
import { activeTurnStepIndexAlong, turnStepAlongBounds } from "./nav/turnStepAlong";
import { formatRouteDistanceMi, routeConsiderationSummary } from "./nav/routeSummary";
import { buildDriveRouteAheadFromImpacts } from "./nav/driveRouteAhead";
import { pickDriveApproachBanner } from "./nav/driveHazardApproachPreview";
import { computeTrafficBypassOffer, pickTrafficBypassAnchorImpact } from "./nav/trafficBypassOffer";
import { earlyApproachMaxMetersForSpeed } from "./nav/surgicalBypassWindow";
import { unifiedTrafficNarrative } from "./nav/trafficNarrative";
import {
  ARRIVAL_BG_CLEAR_MIN_MS,
  DRIVE_AHEAD_WINDOW_M,
  RADAR_SOFT_THRESHOLD,
} from "./nav/constants";
import {
  arrivalIdleClearMs,
  arrivalProximity,
  isStationaryForArrival,
  shouldResetArrivalIdleOnPointer,
} from "./nav/arrivalDetect";
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

const DriveMap = lazy(() => import("./ui/DriveMap"));
import { SearchBar } from "./ui/SearchBar";
import type { SearchSuggestion } from "./ui/SearchBar";
import { BottomToolbar } from "./ui/BottomToolbar";
import { NavMilesLeftBox } from "./ui/NavMilesLeftBox";
import { DriveCompass } from "./ui/DriveCompass";
import { RouteCycleButton, type RoutePickItem } from "./ui/RoutePickBar";
import { routePickSlotHex } from "./ui/mapRouteStyle";
import { routeSlotIndexFor } from "./ui/mapRouteLayers";
import {
  isFullSlotPermutation,
  reconcileSlotOrderWithPlan,
  slotOrderAfterSelect,
} from "./nav/routeSlotOrder";
import { NameConfirmSheet } from "./ui/NameConfirmSheet";
import { SavedDestinationsDrawer } from "./ui/SavedDestinationsDrawer";
import { TopGuidanceBar } from "./ui/TopGuidanceBar";
import { RecordingRouteBanner } from "./ui/RecordingRouteBanner";
import { RouteHazardSheet } from "./ui/RouteHazardSheet";
import { TollFlowSheets } from "./ui/TollFlowSheets";
import { RouteProgressStrip } from "./ui/RouteProgressStrip";
import { RouteOutlookTimeline } from "./ui/RouteOutlookTimeline";
import { estimatePostedSpeedMph } from "./ui/DriveHud";
import { formatEtaDuration } from "./ui/formatEta";
import { StormAdvisoryBar } from "./ui/StormAdvisoryBar";
import { DriveHazardApproachBanner } from "./ui/DriveHazardApproachBanner";
import { ActivityStatusPill } from "./ui/ActivityStatusPill";
import { AboutSheet } from "./ui/AboutSheet";
import { Coachmarks } from "./ui/Coachmarks";
import { resetAllCoachmarks } from "./ui/coachmarks/firstLaunchSteps";
import { RouteCompareBottomPanel } from "./ui/RouteCompareBottomPanel";
import { pointAlongPolyline } from "./ui/geometryAlong";
import { NWS_REQUEST_USER_AGENT } from "./config/nwsUserAgent";
import {
  fetchNwsAlertsForBrowseViewport,
  fetchNwsAlertsForRouteCorridorsMerged,
  nwsBrowseBoundsAroundLngLat,
} from "./weatherAlerts/nwsUsProvider";
import {
  computeRouteOverlapWithAlerts,
  filterAlertsAffectingRoute,
  pointInAnyPolygonGeometry,
  stormAlongBandsForProgressStrip,
  alertRouteIntersectionMeters,
  polygonApproxCentroid,
  closestAlongMeters,
  sortWeatherAlertsBySeverity,
} from "./weatherAlerts/geometryOverlap";
import { mapGeoJsonFromAlerts } from "./weatherAlerts/mapGeoJsonFromAlerts";
import {
  routeAlertForNwsAdvisoryClick,
  routeAlertsFromStormBandMidpoint,
} from "./weatherAlerts/nwsAsRouteAlerts";
import type { NormalizedWeatherAlert } from "./weatherAlerts/types";
import {
  filterMapGeoJsonToBasicEmergencies,
  nwsAlertIsBasicEmergency,
} from "./weatherAlerts/basicEmergencyFilter";
import { nwsAlertsForLocalForecast } from "./weatherAlerts/localForecastNws";
import {
  buildAdvisoryPromoLines,
  buildBasicNavAdvisoryPromoLines,
} from "./config/basicAds";
import { useBasicAdMobBanner } from "./hooks/useBasicAdMobBanner";
import { getPayTier, hasTollBypass } from "./billing/payFeatures";
import { NATIVE_PAY_TIER_CHANGED_EVENT } from "./billing/revenueCat";
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
import { loadRecentSearchSuggestions, recordRecentSearch } from "./recentSearches";
import {
  getTollCompareContext,
  setTollCompareContext,
  type TrafficBypassCompareState,
  useRouteCompareStore,
} from "./state/routeCompareStore";
import { useComputeRoutes } from "./nav/useComputeRoutes";
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

const MB_TRAFFIC_LINE_SNAP_NOTICE = "Mapbox traffic-aware line";
/** Route mode: refresh B/C alternates only (primary leg unchanged). */
/** Debounce after storm/user fingerprint moves before requesting Mapbox again. */
const STORM_ADAPT_DEBOUNCE_MS = 4500;
/** Minimum spacing between adaptive storm reroute attempts (NWS + Directions churn). */
const STORM_ADAPT_MIN_INTERVAL_MS = 75_000;
/** Throttle between auto-reroute attempts when off the polyline. */
const NAV_SEVERE_OFF_ROUTE_THROTTLE_MS = OFF_ROUTE_REROUTE_THROTTLE_MS;
/** Snap drawn line to Mapbox’s road network when live delay vs ORS is huge or Mapbox can’t trace the ORS path. */
const MAPBOX_LINE_SNAP_DELAY_MIN = 10;
/** Applies to both “heavy delay” and untraceable polyline — avoids GPS-driven snap loops in drive/topdown. */
const MAPBOX_LINE_SNAP_COOLDOWN_MS = 45_000;
/** Best-effort cap for IndexedDB writes while still capturing route refreshes. */
const TRIP_CACHE_MIN_SAVE_INTERVAL_MS = 20_000;

function isNarrowPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches;
}

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
  /** Bumped when dev About changes `PAY_TIER_OVERRIDE_LS_KEY` so `getPayTier()` is re-read without reload. */
  const [payTierProbeKey, setPayTierProbeKey] = useState(0);
  const reprobePayTier = useCallback(() => setPayTierProbeKey((n) => n + 1), []);
  /* Phase 7 — RevenueCat fires `NATIVE_PAY_TIER_CHANGED_EVENT` on every customer-info push
   * (purchase, restore, refund, family-share). The wrapper has already mirrored the new
   * entitlement into `safeStorage` by the time this handler runs, so a single
   * `reprobePayTier()` is enough to make `getPayTier()` re-read and the whole app re-render
   * with the right tier. Same mechanism the dev "Test pay tier" panel uses. */
  useEffect(() => {
    const handler = () => reprobePayTier();
    window.addEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
    return () => window.removeEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
  }, [reprobePayTier]);
  /** Plus vs Basic from `getPayTier()` (build env + optional LS override) — identical in dev and production. */
  const isPlus = useMemo(() => getPayTier() === "plus", [payTierProbeKey]);
  const tollBypassEnabled = useMemo(() => hasTollBypass(), [payTierProbeKey]);
  const advisoryPromoLines = useMemo(
    () => (isPlus ? buildAdvisoryPromoLines(env, isPlus) : buildBasicNavAdvisoryPromoLines(env)),
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
  /** Landscape / side view only — CSS mirrors chrome when "left"; portrait ignores */
  const settingLandscapeSideHand = useSettingsStore((s) => s.landscapeSideHand);
  /* Phase 4e3: the About sheet is the only consumer of the individual `setSettingX` setters.
   * `applySettings` writes through all 8 fields in one batched store update and runs each
   * persistence side once. Per-toggle handlers elsewhere (toolbar Radar overlay, etc.) operate
   * on App-owned state (`showRadar`), not on the persistent settings, so they don't need the
   * individual setters either. */
  const applySettings = useSettingsStore((s) => s.applySettings);
  const {
    lngLat: userLngLat,
    heading,
    speedMps,
    error: locationError,
    fixSource: locationFixSource,
  } = useUserLocation(true, {
    highRefresh: settingGpsHighRefreshEnabled,
  });
  const devLocOverrideLngLat = import.meta.env.DEV ? getDevLocationOverrideLngLat() : null;
  const userLngLatRef = useRef(userLngLat);
  userLngLatRef.current = userLngLat;
  const speedMpsRef = useRef(speedMps);
  speedMpsRef.current = speedMps;

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

  const ACTIVITY_TRAIL_MAP_LS = "stormpath-activity-trail-map-on";
  const [activityTrailMapOn, setActivityTrailMapOn] = useState(() => {
    return safeStorage.get(ACTIVITY_TRAIL_MAP_LS) === "1";
  });
  const [homeMapFraming, setHomeMapFraming] = useState<HomeMapFraming>(() => readHomeMapFraming());
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

  /** Map (top-down) follow mode: a few zoom levels wider than route overview for corridor context. */
  const topdownZoomRef = useRef(11.75);

  const { places: savedPlaces, showOnMap, setShowOnMap, addPlace, updateName, removePlace } =
    useSavedPlaces();
  const {
    routes: savedTripRoutes,
    addRoute: addSavedTripRoute,
    updateName: updateSavedTripRouteName,
    removeRoute: removeSavedTripRoute,
  } = useSavedRoutes();

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
  const progressCalloutTrackRef = useRef<HTMLDivElement | null>(null);
  const progressCalloutWasOpenRef = useRef(false);

  /** Road & traffic overlay (Hazards strip + map traffic colors). Default on until user turns off. */
  const [roadAdvisoryDetailOn, setRoadAdvisoryDetailOn] = useState(readRoadAdvisoryDetailOn);

  /* Settings (persisted) — toggles that actually reduce background API calls.
   * Sourced from `useSettingsStore` (Phase 4a). Individual `setSettingX` selectors were
   * dropped in Phase 4e3 — the only consumer (About sheet) now goes through `applySettings`. */
  const settingStormEnabled = useSettingsStore((s) => s.stormEnabled);
  const settingTrafficEnabled = useSettingsStore((s) => s.trafficEnabled);
  const settingWeatherHintsEnabled = useSettingsStore((s) => s.weatherHintsEnabled);
  const settingAutoRerouteEnabled = useSettingsStore((s) => s.autoRerouteEnabled);
  const settingRadarEnabled = useSettingsStore((s) => s.radarEnabled);
  const settingDataSaverEnabled = useSettingsStore((s) => s.dataSaverEnabled);
  const dataSaverHintDismissed = useSettingsStore((s) => s.dataSaverHintDismissed);
  const dismissDataSaverHintAction = useSettingsStore((s) => s.dismissDataSaverHint);
  const appForeground = useAppForeground();
  const dataSaverMode = isDataSaverMode(settingDataSaverEnabled);
  const settingVoiceGuidanceEnabled = useSettingsStore((s) => s.voiceGuidanceEnabled);
  /* Storm/advisory state lives in `useWeatherStore` (Phase 4d). Local names + setter
   * signatures preserved so the ~40 read/setter sites in this file are unchanged. The store
   * action for `setStormBarExpanded` writes through to `safeStorage` so persistence and React
   * state can't drift; `collapseStormBarTransient` covers the route-compare dismiss case that
   * must NOT persist. */
  const stormCorridorAlerts = useWeatherStore((s) => s.stormCorridorAlerts);
  const setStormCorridorAlerts = useWeatherStore((s) => s.setStormCorridorAlerts);
  const stormOverlapping = useWeatherStore((s) => s.stormOverlapping);
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
  /** Full Plus detail stream (all NWS + extended scroll content) when Storm + NWS session are enabled. */
  const advisoryPlusDetailOn = useMemo(
    () => isPlus && settingStormEnabled && stormSessionOn,
    [isPlus, settingStormEnabled, stormSessionOn]
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
  const [searchText, setSearchText] = useState("");
  const searchExpanded = useUiStore((s) => s.searchExpanded);
  const setSearchExpanded = useUiStore((s) => s.setSearchExpanded);
  const searchEditing = useUiStore((s) => s.searchEditing);
  const setSearchEditing = useUiStore((s) => s.setSearchEditing);
  const [allowAutocomplete, setAllowAutocomplete] = useState(true);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  /** Invalidates in-flight autocomplete when the query changes so stale results do not flash in. */
  const searchAutocompleteSeqRef = useRef(0);
  /** Mapbox Search Box session token. One UUID is minted lazily on first autocomplete and reused
   * across every keystroke + the final /retrieve so suggest+retrieve are billed as a single
   * transaction. Reset to null when the user closes the search bar or commits a destination. */
  const searchBoxSessionTokenRef = useRef<string | null>(null);
  const ensureSearchBoxSessionToken = useCallback((): string => {
    if (!searchBoxSessionTokenRef.current) {
      searchBoxSessionTokenRef.current = mintSearchBoxSessionToken();
    }
    return searchBoxSessionTokenRef.current;
  }, []);
  const resetSearchBoxSessionToken = useCallback(() => {
    searchBoxSessionTokenRef.current = null;
  }, []);
  /* Whenever the search bar collapses, end the current Search Box session so the next typing
   * session starts fresh (and Mapbox bills it independently). */
  useEffect(() => {
    if (!searchExpanded) searchBoxSessionTokenRef.current = null;
  }, [searchExpanded]);
  /** Lets suggestion taps win over blur before parent clears the list. */
  const searchBlurClearTimerRef = useRef<number | null>(null);
  /** Bumped on Stop/clear — in-flight route fetches must not call setPlan after the user cleared the trip. */
  const routeGraphEpochRef = useRef(0);
  /** Cancels the active primary Directions request when the user starts a new route, reroutes, or clears. */
  const routeMainFetchAbortRef = useRef<AbortController | null>(null);
  /** B/C refresh while driving — separate from {@link routeMainFetchAbortRef} so it does not cancel a new trip build. */
  const altRoutesFetchAbortRef = useRef<AbortController | null>(null);
  /** Invalidates in-flight NWS fetches when storm deps change so stale responses cannot repopulate the map. */
  const nwsFetchGenRef = useRef(0);
  /** Avoid overlapping `run()` ticks (interval + slow network) leaving loading stuck. */
  const nwsFetchInFlightRef = useRef(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const routingRef = useRef(routing);
  routingRef.current = routing;

  const lastStormAdaptiveRefreshMsRef = useRef(0);
  const stormAdaptiveRefreshInFlightRef = useRef(false);
  /** B/C leg refresh — must not flip global `routing` (advisory shows "Building routes…"). */
  const altRoutesRefreshInFlightRef = useRef(false);
  const [tapHint, setTapHint] = useState<string | null>(null);
  const [returnTripLeg, setReturnTripLeg] = useState<ReturnTripLeg | null>(() => loadReturnTripLeg());
  /** Several geocode hits (business + city, “coffee”, etc.) — map pins + list until user picks one. */
  const [searchPickHits, setSearchPickHits] = useState<SearchSuggestion[] | null>(null);
  const searchPickHitsRef = useRef<SearchSuggestion[] | null>(null);
  searchPickHitsRef.current = searchPickHits;
  /** Query string that produced {@link searchPickHits}; cleared when the user edits the field. */
  const searchPickQueryRef = useRef<string | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [recenterPlanningPuckTick, setRecenterPlanningPuckTick] = useState(0);
  const [weatherOverlay, setWeatherOverlay] = useState<WeatherOverlay | undefined>(
    undefined
  );
  const navigationStarted = useTripPlanStore((s) => s.navigationStarted);
  const setNavigationStarted = useTripPlanStore((s) => s.setNavigationStarted);
  const navigationStartedRef = useRef(navigationStarted);
  navigationStartedRef.current = navigationStarted;

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
  const viewMode = useTripPlanStore((s) => s.viewMode);
  const setViewMode = useTripPlanStore((s) => s.setViewMode);
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
  const [offRouteSevere, setOffRouteSevere] = useState(false);
  /** Hysteresis: latched true until lateral drops below exit threshold (avoids flapping at one distance). */
  const offRouteLatchedRef = useRef(false);
  const lastSevereAutoRecalcMsRef = useRef(0);
  const lastOffRouteSampleRef = useRef<{ t: number; lateralM: number; alongM: number } | null>(null);
  const offRouteRerouteFailStreakRef = useRef(0);
  /** At destination, stationary + no interaction → clearRoute; foreground timer + resume-from-background. */
  const arrivalIdleStartMsRef = useRef<number | null>(null);
  const lastUserInteractionMsRef = useRef<number>(Date.now());
  const tabHiddenAtMsRef = useRef<number | null>(null);
  const lastMbLineSnapMsRef = useRef(0);
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

  /** Recompute routes from current GPS to the same destination without stopping navigation. */
  const recalcRouteFromHere = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!userLngLat || !destLngLat) return;
    if (env.mapboxToken && !isOnline) {
        if (!opts?.silent) {
          setTapHint("Offline: route refresh unavailable.");
          window.setTimeout(() => setTapHint(null), 3500);
        }
        return;
      }
      const epochAtStart = routeGraphEpochRef.current;
      routeMainFetchAbortRef.current?.abort();
      const mainFetch = new AbortController();
      routeMainFetchAbortRef.current = mainFetch;
      setRouting(true);
      setRouteError(null);
      try {
        let p: TripPlan;
        let destForMap: [number, number] = destLngLat;
        let rerouteSnapNotice: string | undefined;
        if (env.mapboxToken) {
          const built = await buildTripFromMapbox(
            env.mapboxToken,
            userLngLat,
            destLngLat,
            {
              origin: "Your location",
              destination: destinationLabel.trim() || "Destination",
            },
            {
              signal: mainFetch.signal,
              allowLocalTripThirdRoute: isPlus,
              preferThreeRoutes: isPlus,
              stormAlerts: stormAlertsForRouting,
              radarAvoidanceEnabled: isPlus && settingStormEnabled,
              trailRoutePersonalization: isPlus && learnEnabled,
            }
          );
          p = built.plan;
          destForMap = built.routeDestination;
          rerouteSnapNotice = built.snapNotice;
        } else {
          p = buildMockTripBetween(userLngLat, destLngLat, destinationLabel.trim() || "Destination");
        }
        p = !isPlus && p.routes.length > 2 ? { ...p, routes: p.routes.slice(0, 2) } : p;
        if (epochAtStart !== routeGraphEpochRef.current) return;
        setPlan(p);
        setDestLngLat(destForMap);
        setPreviewLegIndex(0);
        const planIds = p.routes.map((r) => r.id);
        setRouteSlotOrder((prev) => reconcileSlotOrderWithPlan(prev, planIds));
        setFitTrigger((n) => n + 1);
        setOffRouteSevere(false);
        offRouteRerouteFailStreakRef.current = 0;
        if (!opts?.silent) {
          if (rerouteSnapNotice) {
            setTapHint(rerouteSnapNotice);
            window.setTimeout(() => setTapHint(null), 8500);
          } else {
            setTapHint("Route updated from your position.");
            window.setTimeout(() => setTapHint(null), 4500);
          }
        }
      } catch (e) {
        if (isAbortError(e)) {
          return;
        }
        const msg =
          routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e));
        setRouteError(msg);
        setOffRouteSevere(false);
        offRouteRerouteFailStreakRef.current += 1;
        if (offRouteRerouteFailStreakRef.current >= 2) {
          // Rare fallback: if we can’t recover from GPS, stop nav and show options.
          resetNavigationPlanning();
          setViewMode("route");
          setTapHint("Could not reconnect to the route. Showing A/B/C options…");
          window.setTimeout(() => setTapHint(null), 8000);
        }
        if (userLngLat && destLngLat) {
          void computeRoutes(destLngLat, destinationLabel.trim() || "Destination", {
            preserveNavigation: true,
          });
        }
      } finally {
        setRouting(false);
      }
    },
    [userLngLat, destLngLat, env.mapboxToken, destinationLabel, computeRoutes, isOnline, resetNavigationPlanning, isPlus, stormAlertsForRouting, settingStormEnabled]
  );

  const handleMapClick = useCallback(
    async (lng: number, lat: number) => {
      if (navigationStarted && plan.routes.length > 0) {
        setTapHint("Stop navigation first to pick a new destination on the map.");
        window.setTimeout(() => setTapHint(null), 5000);
        return;
      }
      if (!userLngLat) {
        setTapHint(
          locationError ??
            "Turn on location first — we need your position to build a route."
        );
        window.setTimeout(() => setTapHint(null), 8000);
        return;
      }
      setAllowAutocomplete(false);
      setSuggestions([]);
      setSuggestLoading(false);
      const end: [number, number] = [lng, lat];
      setDestLngLat(end);
      const pinLabel = `Pin · ${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
      setDestinationLabel(pinLabel);
      setSearchText(pinLabel);
      /* Jump to route-planning view immediately so the driver can choose A/B/C as soon as data lands. */
      setViewMode("route");
      setFitTrigger((n) => n + 1);
      setSearchExpanded(false);

      /*
       * Route Directions ASAP — do not block on reverse geocode (that was adding a full round-trip
       * before routing even started). Update the label when the place name returns.
       */
      void computeRoutes(end, pinLabel);

      if (env.mapboxToken) {
        void mapboxReverseGeocode(lng, lat, env.mapboxToken)
          .then((rev) => {
            if (rev?.placeName) {
              setDestinationLabel(rev.placeName);
              setSearchText(rev.placeName);
              recordRecentSearch(rev.placeName, end);
            }
          })
          .catch(() => {
            /* keep pin label */
          });
      } else {
        recordRecentSearch(pinLabel, end);
      }
    },
    [
      userLngLat,
      computeRoutes,
      env.mapboxToken,
      locationError,
      recordRecentSearch,
      navigationStarted,
      plan.routes.length,
    ]
  );

  const handleSavedPlaceNavigate = useCallback(
    (lngLat: [number, number], label: string) => {
      if (!userLngLat) {
        setTapHint(
          locationError ?? "Turn on location first — allow it for this site in browser settings."
        );
        window.setTimeout(() => setTapHint(null), 8000);
        return;
      }
      recordRecentSearch(label, lngLat);
      setAllowAutocomplete(false);
      setSuggestions([]);
      setSearchExpanded(false);
      setDestLngLat(lngLat);
      setDestinationLabel(label);
      setSearchText(label);
      setSavedDrawerOpen(false);
      setViewMode("route");
      void computeRoutes(lngLat, label);
    },
    [userLngLat, computeRoutes, locationError, recordRecentSearch]
  );

  const handleSavedMarkerClick = useCallback(
    (id: string) => {
      const p = savedPlaces.find((x) => x.id === id);
      if (!p) return;
      handleSavedPlaceNavigate(p.lngLat, p.name);
    },
    [savedPlaces, handleSavedPlaceNavigate]
  );

  const handlePickSuggestion = useCallback(
    async (hit: SearchSuggestion) => {
      if (!userLngLat) {
        setTapHint(
          locationError ?? "Turn on location before picking a place."
        );
        window.setTimeout(() => setTapHint(null), 8000);
        return;
      }
      let lngLat = hit.lngLat;
      let placeName = hit.placeName;
      /* Search Box suggestions don't carry coordinates — resolve them now via /retrieve so the
       * destination flow downstream sees a real lng/lat. We reuse the same session token that
       * was minted for /suggest so Mapbox bills the autocomplete + retrieve as one transaction. */
      if (hit.mapboxId) {
        if (!env.mapboxToken) {
          setTapHint("Mapbox token needed to look up that place.");
          window.setTimeout(() => setTapHint(null), 4000);
          return;
        }
        setRouting(true);
        const sessionToken = ensureSearchBoxSessionToken();
        const retrieved = await mapboxSearchBoxRetrieve(hit.mapboxId, env.mapboxToken, sessionToken);
        setRouting(false);
        if (!retrieved) {
          setTapHint("Couldn't fetch that place's coordinates. Try another match or hit search.");
          window.setTimeout(() => setTapHint(null), 6000);
          return;
        }
        lngLat = retrieved.lngLat;
        placeName = retrieved.placeName;
        /* Session is consumed on retrieve — start a fresh token next time the user types. */
        resetSearchBoxSessionToken();
      }
      setSearchPickHits(null);
      searchPickQueryRef.current = null;
      recordRecentSearch(placeName, lngLat);
      setAllowAutocomplete(true);
      setSuggestions([]);
      setSearchText(placeName);
      setDestinationLabel(placeName);
      setDestLngLat(lngLat);
      setViewMode("route");
      setSearchExpanded(false);
      await computeRoutes(lngLat, placeName);
    },
    [
      userLngLat,
      computeRoutes,
      locationError,
      recordRecentSearch,
      env.mapboxToken,
      ensureSearchBoxSessionToken,
      resetSearchBoxSessionToken,
    ]
  );

  const handleSearchPickFromMap = useCallback(
    (id: string) => {
      const hit = searchPickHitsRef.current?.find((h) => h.id === id);
      if (hit) void handlePickSuggestion(hit);
    },
    [handlePickSuggestion]
  );

  const handleSearch = useCallback(async () => {
    const q = searchText.trim();
    if (!q) return;
    if (!userLngLat) {
      setTapHint(
        locationError ?? "Turn on location before searching — or use HTTPS if you opened this page from a home Wi‑Fi address."
      );
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    if (!env.mapboxToken) {
      setTapHint("Mapbox token needed for address search.");
      window.setTimeout(() => setTapHint(null), 4000);
      return;
    }
    setSearchPickHits(null);
    searchPickQueryRef.current = null;
    setRouting(true);
    setRouteError(null);
    const hits = await mapboxGeocodeSearch(q, env.mapboxToken, {
      proximity: userLngLat ?? undefined,
      limit: 12,
      /* Scope to the user's continent so a typo doesn't surface London/Moscow/Sydney for a US
       * driver. `null` (no GPS yet, or ocean cell) → undefined → no filter (full world). */
      countries: geocodeCountriesForFix(userLngLat) ?? undefined,
    });
    setRouting(false);
    if (hits.length === 0) {
      setRouteError("No results for that search.");
      return;
    }
    if (hits.length === 1) {
      const hit = hits[0]!;
      recordRecentSearch(hit.placeName, hit.lngLat);
      setAllowAutocomplete(true);
      setDestLngLat(hit.lngLat);
      setDestinationLabel(hit.placeName);
      setSearchText(hit.placeName);
      setViewMode("route");
      setSearchExpanded(false);
      await computeRoutes(hit.lngLat, hit.placeName);
      return;
    }
    searchPickQueryRef.current = q;
    setSearchPickHits(hits);
    setSuggestions(hits);
    setAllowAutocomplete(true);
    setTapHint(`${hits.length} matches — tap an orange pin or a result below.`);
    window.setTimeout(() => setTapHint(null), 10_000);
  }, [searchText, userLngLat, env.mapboxToken, computeRoutes, locationError, recordRecentSearch]);

  const searchPickMarkersForMap = useMemo((): { id: string; lngLat: LngLat; label: string }[] | null => {
    if (!searchPickHits || searchPickHits.length < 2) return null;
    return searchPickHits.map((h) => ({ id: h.id, lngLat: h.lngLat, label: h.placeName }));
  }, [searchPickHits]);

  /** Drop map pins if the user edits the query after a multi-result search. */
  useEffect(() => {
    const pinned = searchPickQueryRef.current;
    if (pinned == null) return;
    if (searchText.trim() !== pinned) {
      setSearchPickHits(null);
      searchPickQueryRef.current = null;
    }
  }, [searchText]);

  /** Focus search: do not clear text (avoids compact/input flicker); compact chip uses its own reset. */
  const handleSearchFieldBeginEditing = useCallback(() => {
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
      searchBlurClearTimerRef.current = null;
    }
    setSearchEditing(true);
    const t = searchText.trim();
    if (isNarrowPhoneViewport() && t.length <= 1) {
      setSuggestions(rankSearchSuggestionsWithTrail(loadRecentSearchSuggestions()));
    }
    setSuggestLoading(false);
    setAllowAutocomplete(true);
  }, [searchText, rankSearchSuggestionsWithTrail]);

  const handleSearchFieldEndEditing = useCallback(() => {
    setSearchEditing(false);
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
    }
    searchBlurClearTimerRef.current = window.setTimeout(() => {
      searchBlurClearTimerRef.current = null;
      if (searchPickHitsRef.current && searchPickHitsRef.current.length >= 2) return;
      setSuggestions([]);
      setSuggestLoading(false);
    }, 280);
  }, []);

  const handleSearchCancelSuggestions = useCallback(() => {
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
      searchBlurClearTimerRef.current = null;
    }
    setSearchEditing(false);
    setSearchPickHits(null);
    searchPickQueryRef.current = null;
    setSuggestions([]);
    setSuggestLoading(false);
  }, []);

  /** × on the search bar — collapse to compact destination and clear stuck suggestion lists. */
  const handleSearchDismiss = useCallback(() => {
    handleSearchCancelSuggestions();
    setAllowAutocomplete(false);
    if (plan.routes.length > 0) {
      setSearchExpanded(false);
    }
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  }, [handleSearchCancelSuggestions, plan.routes.length]);

  const handleCompactDestOpen = useCallback(() => {
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
      searchBlurClearTimerRef.current = null;
    }
    setSearchPickHits(null);
    searchPickQueryRef.current = null;
    setSearchExpanded(true);
    setSearchEditing(true);
    setSearchText("");
    if (isNarrowPhoneViewport()) {
      setSuggestions(rankSearchSuggestionsWithTrail(loadRecentSearchSuggestions()));
    } else {
      setSuggestions([]);
    }
    setSuggestLoading(false);
    setAllowAutocomplete(true);
  }, [rankSearchSuggestionsWithTrail]);

  useEffect(
    () => () => {
      if (searchBlurClearTimerRef.current) {
        window.clearTimeout(searchBlurClearTimerRef.current);
      }
    },
    []
  );

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

  useEffect(() => {
    if (!searchExpanded && plan.routes.length > 0) {
      setSearchEditing(false);
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    const q = searchText.trim();
    if (!allowAutocomplete) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    const seq = ++searchAutocompleteSeqRef.current;
    const narrow = isNarrowPhoneViewport();
    const limit = narrow ? 5 : 8;

    if (q.length < 2) {
      if (narrow && searchEditing) {
        setSuggestions(rankSearchSuggestionsWithTrail(loadRecentSearchSuggestions()));
        setSuggestLoading(false);
        return;
      }
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    if (!env.mapboxToken) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    const t = window.setTimeout(() => {
      if (seq !== searchAutocompleteSeqRef.current) return;
      setSuggestions([]);
      setSuggestLoading(true);
      const prox = userLngLatRef.current ?? undefined;
      const countries = geocodeCountriesForFix(userLngLatRef.current) ?? undefined;
      /* Search Box has much deeper local-business coverage than Geocoding v5. We try it first
       * and only fall back to the geocoder when Search Box returns nothing (rare network glitch
       * or off-the-grid query). The session token batches every keystroke + the final /retrieve
       * into one Mapbox-billed transaction. */
      const sessionToken = ensureSearchBoxSessionToken();
      void mapboxSearchBoxSuggest(q, env.mapboxToken, sessionToken, {
        proximity: prox,
        countries,
        limit,
      })
        .then(async (sbHits) => {
          if (seq !== searchAutocompleteSeqRef.current) return null;
          if (sbHits.length > 0) {
            /* North America defaults to miles for distance display, everywhere else metric. */
            const useMiles =
              !!prox && (geocodeCountriesForFix(prox) ?? []).some((c) => c === "us" || c === "ca");
            const out: SearchSuggestion[] = sbHits.map((s) => {
              /* Compose the secondary line as "1.2 mi · 1234 Main St, Decatur, IL" so users can
               * verify the closest-first ordering at a glance. Distance shows even when the
               * formatted address is missing (rare). */
              const distLabel = formatDistanceShort(s.distanceMeters, useMiles);
              const secondary =
                distLabel && s.placeFormatted
                  ? `${distLabel} · ${s.placeFormatted}`
                  : distLabel || s.placeFormatted;
              return {
                id: s.mapboxId,
                /* Real lng/lat is fetched on pick via /retrieve. We stash a placeholder here so
                 * the row renders; handlePickSuggestion checks `mapboxId` to decide which path. */
                lngLat: prox ?? [0, 0],
                placeName: s.name,
                secondary,
                mapboxId: s.mapboxId,
                featureType: s.featureType,
              };
            });
            return out;
          }
          /* Fallback to Geocoding v5 — keeps the user unblocked if Search Box hiccups. */
          const fb = await mapboxAutocomplete(q, env.mapboxToken, limit, prox, countries);
          if (seq !== searchAutocompleteSeqRef.current) return null;
          return fb;
        })
        .then((hits) => {
          if (hits == null) return;
          if (seq !== searchAutocompleteSeqRef.current) return;
          setSuggestions(rankSearchSuggestionsWithTrail(hits.slice(0, limit)));
          setSuggestLoading(false);
        });
    }, 280);
    return () => window.clearTimeout(t);
    /* userLngLat omitted: GPS updates ~400ms would cancel this debounce and flash the list every tick. */
  }, [
    searchText,
    env.mapboxToken,
    allowAutocomplete,
    searchExpanded,
    plan.routes.length,
    searchEditing,
    rankSearchSuggestionsWithTrail,
    activityTrailTick,
  ]);

  const planRef = useRef(plan);
  planRef.current = plan;
  const planRoutesKeyStable = useMemo(() => plan.routes.map((r) => r.id).join("|"), [plan.routes]);

  /** OpenWeather corridor overlay: one active leg only (not all A/B/C in parallel). */
  const owWeatherFocusLegId = useMemo(() => {
    if (!navigationStarted) return "";
    const planIds = plan.routes.map((r) => r.id);
    if (!planIds.length) return "";
    const ordered = isFullSlotPermutation(routeSlotOrder, planIds)
      ? routeSlotOrder
      : planIds;
    if (viewMode !== "route") return ordered[0] ?? planIds[0] ?? "";
    return ordered[previewLegIndex] ?? ordered[0] ?? planIds[0] ?? "";
  }, [navigationStarted, viewMode, previewLegIndex, routeSlotOrder, planRoutesKeyStable]);

  const owWeatherGeomKey = useMemo(() => {
    if (!owWeatherFocusLegId) return "";
    const g = plan.routes.find((r) => r.id === owWeatherFocusLegId)?.geometry;
    if (!g || g.length < 2) return "";
    const f = g[0]!;
    const l = g[g.length - 1]!;
    return `${owWeatherFocusLegId}:${g.length}:${Math.round(f[0] * 1000)}:${Math.round(f[1] * 1000)}:${Math.round(l[0] * 1000)}:${Math.round(l[1] * 1000)}`;
  }, [owWeatherFocusLegId, plan.routes]);

  const lastOwOverlayGeomKeyRef = useRef("");
  const lastOwOverlayAtRef = useRef(0);
  const OW_OVERLAY_MIN_MS = 20 * 60 * 1000;

  /* "Right now" point reading near the user — drives the advisory bar's compact nowcast line.
   * Independent of the route weather overlay above: this fires whenever we have a position,
   * even before a route is loaded. Throttled to ~10 min, plus an extra refresh when the user
   * moves more than ~25 km from the last sample. */
  const [currentNowcast, setCurrentNowcast] = useState<CurrentNowcast | null>(null);
  const [forecastPlaceShort, setForecastPlaceShort] = useState<string | null>(null);
  const lastNowcastFixRef = useRef<{ lng: number; lat: number; tMs: number } | null>(null);
  /* Track transient failures separately from the last successful sample. The old code
   * "claimed" the throttle slot before the request finished, which meant one dropped
   * OpenWeather call could suppress the local-weather line for the next 10 minutes. */
  const lastNowcastFailureRef = useRef<{ lng: number; lat: number; tMs: number } | null>(null);
  const nowcastFetchInFlightRef = useRef(false);
  /* Note: an outer `userLngLatRef` is maintained at component top so the slow background
   * interval below can sample the latest position without putting userLngLat in its dep
   * array. With userLngLat in the deps, the interval was torn down and re-created every GPS
   * tick (~400 ms while driving) and never reached its 10-minute mark. */
  /* Mounted flag for safe state updates after async completion. We deliberately do NOT cancel
   * mid‑flight requests on every userLngLat tick — that's what was happening before, and on
   * TestFlight (constant GPS updates + slower cell vs. dev wifi) it meant the OpenWeather
   * response would arrive into a closure where `cancelled = true`, silently dropping the
   * "Now" line. nowcastFetchInFlightRef already prevents stacked fetches. */
  const nowcastMountedRef = useRef(true);
  useEffect(() => {
    nowcastMountedRef.current = true;
    return () => {
      nowcastMountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!isOnline) return;
    if (!env.openWeatherApiKey) return;
    if (isOpenWeatherRateLimited()) return;
    if (!userLngLat) return;
    const [lng, lat] = userLngLat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const NOW_REFRESH_MS = 10 * 60 * 1000;
    const NOW_FAR_M = 25_000;
    const NOW_FAIL_RETRY_MS = 90 * 1000;
    const NOW_FAIL_RETRY_MOVE_M = 5_000;
    const NOW_RATE_LIMIT_RETRY_MS = 60 * 60 * 1000;
    const last = lastNowcastFixRef.current;
    const now = Date.now();
    if (last) {
      const farEnough = haversineMeters([last.lng, last.lat], [lng, lat]) >= NOW_FAR_M;
      const ageMs = now - last.tMs;
      if (!farEnough && ageMs < NOW_REFRESH_MS) return;
    }
    const lastFailure = lastNowcastFailureRef.current;
    if (lastFailure) {
      const movedEnough =
        haversineMeters([lastFailure.lng, lastFailure.lat], [lng, lat]) >= NOW_FAIL_RETRY_MOVE_M;
      const ageMs = now - lastFailure.tMs;
      const retryMs = isOpenWeatherRateLimited() ? NOW_RATE_LIMIT_RETRY_MS : NOW_FAIL_RETRY_MS;
      if (!movedEnough && ageMs < retryMs) return;
    }
    if (nowcastFetchInFlightRef.current) return;

    void (async () => {
      nowcastFetchInFlightRef.current = true;
      try {
        const nc = await fetchCurrentNowcast(env.openWeatherApiKey, lat, lng);
        lastNowcastFixRef.current = { lng, lat, tMs: nc.fetchedAtMs };
        lastNowcastFailureRef.current = null;
        if (nowcastMountedRef.current) setCurrentNowcast(nc);
      } catch {
        lastNowcastFailureRef.current = { lng, lat, tMs: Date.now() };
        /* Soft fail: keep the previous reading visible (or none) so the banner doesn't flicker. */
      } finally {
        nowcastFetchInFlightRef.current = false;
      }
    })();
    /* userLngLat is intentionally a dependency so re-fetches happen on big moves; the throttle
     * inside the effect prevents minute-by-minute storms while you sit still or drive locally. */
  }, [userLngLat, isOnline, env.openWeatherApiKey]);

  /* Slow background refresh — every 10 min — even if userLngLat hasn't changed. Picks up
   * temperature drift, wind shifts, light precip. Note: deps are intentionally stable
   * (no userLngLat) so the timer survives GPS ticks and actually reaches its 10‑min mark.
   * Position is read from userLngLatRef when the interval fires. */
  useEffect(() => {
    if (!isOnline) return;
    if (!env.openWeatherApiKey) return;
    const id = window.setInterval(() => {
      if (isOpenWeatherRateLimited()) return;
      const cur = userLngLatRef.current;
      if (!cur) return;
      const [lng, lat] = cur;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (nowcastFetchInFlightRef.current) return;
      void (async () => {
        nowcastFetchInFlightRef.current = true;
        try {
          const nc = await fetchCurrentNowcast(env.openWeatherApiKey, lat, lng);
          lastNowcastFixRef.current = { lng, lat, tMs: nc.fetchedAtMs };
          lastNowcastFailureRef.current = null;
          if (nowcastMountedRef.current) setCurrentNowcast(nc);
        } catch {
          lastNowcastFailureRef.current = { lng, lat, tMs: Date.now() };
          /* Soft fail; keep previous reading. */
        } finally {
          nowcastFetchInFlightRef.current = false;
        }
      })();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [isOnline, env.openWeatherApiKey]);

  useEffect(() => {
    if (routingRef.current) return;
    if (!navigationStarted) {
      setWeatherOverlay(undefined);
      lastOwOverlayGeomKeyRef.current = "";
      lastOwOverlayAtRef.current = 0;
      return;
    }

    const owKey = env.openWeatherApiKey;
    const wantOpenWeather = Boolean(owKey) && settingWeatherHintsEnabled;
    if (!isPlus || !isOnline || !owWeatherFocusLegId || !owWeatherGeomKey || !wantOpenWeather) {
      setWeatherOverlay(undefined);
      return;
    }
    if (isOpenWeatherRateLimited()) return;

    const geomUnchanged = owWeatherGeomKey === lastOwOverlayGeomKeyRef.current;
    if (geomUnchanged && Date.now() - lastOwOverlayAtRef.current < OW_OVERLAY_MIN_MS) {
      return;
    }

    const routes = planRef.current.routes;
    const r = routes.find((x) => x.id === owWeatherFocusLegId) ?? routes[0];
    if (!r?.geometry?.length) {
      setWeatherOverlay(undefined);
      return;
    }

    let cancelled = false;
    const LONG_ROUTE_M = 1_000_000;
    const LONG_ETA_MIN = 720;
    const saveData = dataSaverMode;

    (async () => {
      let headline = "";
      let precipHint = 0;
      let samples: NonNullable<WeatherOverlay[string]>["samples"] | undefined;

      const eta = r.baseEtaMinutes ?? 30;
      const lenM = polylineLengthMeters(r.geometry);
      const longTrip = saveData || lenM > LONG_ROUTE_M || eta > LONG_ETA_MIN;

      if (wantOpenWeather && owKey) {
        try {
          if (longTrip) {
            const hint = await weatherHintSamplesAlongPolyline(owKey, r.geometry);
            if (!cancelled) {
              headline = hint.headline;
              precipHint = hint.precipHint ?? 0;
              samples = hint.samples;
            }
          } else {
            const hint = await weatherHintSamplesAlongPolyline(owKey, r.geometry);
            if (!cancelled) {
              headline = hint.headline;
              precipHint = hint.precipHint ?? 0;
              samples = hint.samples;
            }
            if (!cancelled && !isOpenWeatherRateLimited()) {
              const fc = await weatherForecastAlongRoute(owKey, r.geometry, eta);
              if (!cancelled) {
                headline = fc.headline || headline;
                precipHint = Math.max(fc.precipHint ?? 0, precipHint);
              }
            }
          }
        } catch {
          /* keep previous overlay on failure */
        }
      }

      if (cancelled) return;
      lastOwOverlayGeomKeyRef.current = owWeatherGeomKey;
      lastOwOverlayAtRef.current = Date.now();

      if (precipHint > 0 || headline.trim() || samples?.length) {
        setWeatherOverlay({
          [r.id]: {
            headline: headline.trim() || "Conditions along route",
            precipHint,
            samples,
          },
        });
      } else {
        setWeatherOverlay(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    owWeatherGeomKey,
    owWeatherFocusLegId,
    env.openWeatherApiKey,
    settingWeatherHintsEnabled,
    dataSaverMode,
    isOnline,
    navigationStarted,
    isPlus,
  ]);

  const trafficRefreshRef = useRef(0);
  const [trafficRefreshKey, setTrafficRefreshKey] = useState(0);

  useEffect(() => {
    const routes = planRef.current.routes;
    if (routingRef.current) {
      return;
    }
    if (!navigationStarted) {
      setTrafficOverlay(undefined);
      setTrafficFetchDone(true);
      return;
    }
    if (!isPlus || !isOnline || !settingTrafficEnabled || !env.mapboxToken || !routes.length) {
      if (import.meta.env.DEV) {
        console.info(
          "[traffic] skipping fetch —",
          !isPlus
            ? "basic tier"
            : !isOnline
              ? "offline"
              : !settingTrafficEnabled
                ? "setting OFF"
                : !env.mapboxToken
                  ? "no token"
                  : "no routes"
        );
      }
      setTrafficOverlay(undefined);
      setTrafficFetchDone(true);
      return;
    }
    let cancelled = false;
    setTrafficFetchDone(false);
    if (import.meta.env.DEV) {
      console.info("[traffic v2] fetching for", routes.length, "route(s)…");
    }
    (async () => {
      const next: TrafficOverlay = {};
      await Promise.all(
        routes.map(async (r) => {
          if (cancelled) return;
          try {
            const leg = await fetchMapboxTrafficAlongPolyline(env.mapboxToken, r.geometry);
            if (import.meta.env.DEV) {
              console.info(
                "[traffic v2] route",
                r.id,
                "→",
                leg
                  ? `live ${leg.mapboxDurationMinutes.toFixed(1)} min, typical ${leg.typicalDurationMinutes.toFixed(1)}, delay ${leg.delayVsTypicalMinutes.toFixed(1)}, congestion: ${leg.congestionSummary}`
                  : "null (API returned no data)"
              );
            }
            if (!cancelled) next[r.id] = leg;
          } catch (err) {
            console.warn("[traffic v2] route", r.id, "fetch error:", err);
            if (!cancelled) next[r.id] = null;
          }
        })
      );
      if (!cancelled) {
        setTrafficOverlay(next);
        setTrafficFetchDone(true);
        const live = Object.values(next).filter(Boolean).length;
        if (import.meta.env.DEV) {
          console.info("[traffic v2] overlay set, routes with live data:", live);
          if (live === 0) {
            console.warn("[traffic v2] WARNING: all routes returned null — check Mapbox token and API access");
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    planRoutesKeyStable,
    env.mapboxToken,
    settingTrafficEnabled,
    isOnline,
    trafficRefreshKey,
    navigationStarted,
    isPlus,
  ]);

  useEffect(() => {
    if (!appForeground) return;
    if (!planRoutesKeyStable || !settingTrafficEnabled || !navigationStarted || !isPlus) return;
    const id = window.setInterval(() => {
      trafficRefreshRef.current += 1;
      setTrafficRefreshKey(trafficRefreshRef.current);
    }, getTrafficPollIntervalMs(dataSaverMode));
    return () => window.clearInterval(id);
  }, [appForeground, planRoutesKeyStable, settingTrafficEnabled, navigationStarted, isPlus, dataSaverMode]);

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

  /**
   * Replanning can replace A/B/C while keeping the same slot ids (`r-a|r-b|r-c`) and the same route
   * count — nothing else re-fires then. If the user was in Mp/Dr from a prior session or any code
   * left a non-route mode, force Rt + compact chrome whenever we have a planning trip.
   */
  useEffect(() => {
    if (navigationStarted) return;
    if (!plan.routes.length) return;
    setViewMode("route");
    setSearchExpanded(false);
    setFitTrigger((n) => n + 1);
  }, [planRoutesKey, destLngLat, navigationStarted]);

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

  /** Fingerprint for moving storm mass + driver movement — triggers debounced reroute while navigating. */
  const stormAdaptiveSig = useMemo(() => {
    if (!navigationStarted || !userLngLat || !destLngLat || !stormAlertsForRouting?.length) {
      return "";
    }
    if (!hasAdaptiveStormThreatAlongTrip(userLngLat, destLngLat, stormAlertsForRouting)) {
      return "";
    }
    return stormAdaptiveRoutingSignature(userLngLat, destLngLat, stormAlertsForRouting);
  }, [navigationStarted, userLngLat, destLngLat, stormAlertsForRouting]);

  /** After Go: NWS + corridor bands use the promoted primary (slot A), not the A/B/C preview leg. */
  const nwsNavCorridorGeom = useMemo(() => {
    if (!navigationStarted) return undefined;
    const id = orderedRouteIds[0];
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
      const primaryId = orderedRouteIds[0];
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

  /** Storm polygons or position shifted — refresh leg C via merge, or full replan when primary is `r-c`. */
  const refreshStormAwareRoutes = useCallback(async () => {
    if (!navigationStarted || !userLngLat || !destLngLat) return;
    if (!stormAlertsForRouting?.length) return;
    if (env.mapboxToken && !isOnline) return;
    if (plan.routes.length < 2) return;
    if (
      routingRef.current ||
      stormAdaptiveRefreshInFlightRef.current ||
      altRoutesRefreshInFlightRef.current
    ) {
      return;
    }
    const now = Date.now();
    if (now - lastStormAdaptiveRefreshMsRef.current < STORM_ADAPT_MIN_INTERVAL_MS) return;

    stormAdaptiveRefreshInFlightRef.current = true;
    lastStormAdaptiveRefreshMsRef.current = now;
    try {
      const primaryId = orderedRouteIds[0];
      if (primaryId === "r-c") {
        await recalcRouteFromHere({ silent: true });
      } else {
        await refreshAlternateRoutesOnly({ allowDuringDrive: true });
      }
    } finally {
      stormAdaptiveRefreshInFlightRef.current = false;
    }
  }, [
    navigationStarted,
    userLngLat,
    destLngLat,
    stormAlertsForRouting,
    env.mapboxToken,
    isOnline,
    plan.routes.length,
    orderedRouteIds,
    recalcRouteFromHere,
    refreshAlternateRoutesOnly,
  ]);

  useEffect(() => {
    const n = orderedRouteIds.length;
    if (n === 0) return;
    setPreviewLegIndex((i) => Math.min(i, n - 1));
  }, [orderedRouteIds.length]);

  /**
   * Planning + route map: focused leg follows A/B/C preview at any time (including after Go).
   * Drive / top-down while navigating: slot 0 — the promoted primary leg (turn-by-turn follows this).
   */
  const lineFocusId =
    navigationStarted && viewMode !== "route"
      ? (orderedRouteIds[0] ?? primaryRouteId)
      : (orderedRouteIds[previewLegIndex] ?? orderedRouteIds[0] ?? primaryRouteId);

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

  const guidanceRouteId = lineFocusId || primaryRouteId;
  const guidanceRoute = plan.routes.find((r) => r.id === guidanceRouteId);
  const showDataSaverHint =
    isPlus &&
    !dataSaverMode &&
    !dataSaverHintDismissed &&
    Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2);
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

  /** Data saver: one corridor (+ shared national feed) instead of every A/B/C leg each poll. */
  const nwsRouteGeomsForFetch = useMemo((): LngLat[][] => {
    const all = plan.routes
      .map((r) => r.geometry)
      .filter((g): g is LngLat[] => Boolean(g && g.length >= 2));
    if (!dataSaverMode) return all;
    if (navigationStarted) {
      const g = nwsNavCorridorGeom;
      return g && g.length >= 2 ? [g] : all.length ? [all[0]!] : [];
    }
    const focused = plan.routes.find((r) => r.id === lineFocusId)?.geometry;
    if (focused && focused.length >= 2) return [focused];
    return all.length ? [all[0]!] : [];
  }, [dataSaverMode, navigationStarted, nwsNavCorridorGeom, plan.routes, lineFocusId]);

  const nwsRouteGeomsForFetchRef = useRef(nwsRouteGeomsForFetch);
  nwsRouteGeomsForFetchRef.current = nwsRouteGeomsForFetch;

  const nwsPollIntervalMs = useMemo(
    () => getNwsPollIntervalMs(dataSaverMode, navigationStarted),
    [dataSaverMode, navigationStarted]
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
    if (!demoBypassTrafficJamPlus || demoPlaybackAlongM == null || !guidanceRoute?.geometry?.length) {
      return userLngLat;
    }
    return pointAtAlongMeters(guidanceRoute.geometry, demoPlaybackAlongM);
  }, [demoBypassTrafficJamPlus, demoPlaybackAlongM, guidanceRoute?.geometry, userLngLat]);

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
        const n = liveTrafficNarrative;
        if (n) {
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
        } else {
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
    const g = guidanceRoute?.geometry;
    return g && g.length >= 2 ? polylineLengthMeters(g) : 0;
  }, [guidanceRoute?.geometry]);

  const [alongHoldResetKey, setAlongHoldResetKey] = useState(0);
  const userAlongGuidanceM = useAlongRouteMetersHeldWhenOffLine(
    effectiveUserLngLat,
    guidanceRoute?.geometry,
    alongHoldResetKey
  );

  const guidanceRouteGeomRef = useRef<LngLat[] | null>(null);
  const guidanceRouteLengthMRef = useRef(0);
  const userAlongGuidanceMRef = useRef(0);
  guidanceRouteGeomRef.current = guidanceRoute?.geometry ?? null;
  guidanceRouteLengthMRef.current = guidanceRouteLengthM;
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

  const turnStepBounds = useMemo(
    () => turnStepAlongBounds(turnSteps, guidanceRouteLengthM),
    [turnSteps, guidanceRouteLengthM]
  );

  const activeTurnIndex = useMemo(
    () => activeTurnStepIndexAlong(turnStepBounds.end, userAlongGuidanceM),
    [turnStepBounds.end, userAlongGuidanceM]
  );

  /**
   * Banner + voice use the next meaningful maneuver with along-route distance to *that* maneuver.
   * Minor upcoming steps (continue, slight/bear, etc.) are skipped while still far — see `bannerPrimaryStep`.
   */
  const bannerGuidance = useMemo(
    () =>
      bannerPrimaryStepIndex(turnSteps, activeTurnIndex, turnStepBounds.start, userAlongGuidanceM),
    [turnSteps, activeTurnIndex, turnStepBounds.start, userAlongGuidanceM]
  );

  const bannerTurnIndex = bannerGuidance.primaryIndex;
  const metersToBannerManeuver = bannerGuidance.metersToPrimaryManeuver;
  const bannerTurnInstruction = turnSteps[bannerTurnIndex]?.instruction ?? "";

  useTurnVoiceGuidance({
    enabled: settingVoiceGuidanceEnabled,
    navigating: navigationStarted,
    activeTurnIndex: bannerTurnIndex,
    instruction: bannerTurnInstruction,
    metersToManeuverEnd: metersToBannerManeuver,
    routeLegId: guidanceRouteId,
  });

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

  const scoredNavHealthRef = useRef(scored);
  scoredNavHealthRef.current = scored;

  /** Miles / ETA / time-left integrity — periodic audit + throttled repair (traffic refresh, along reset). */
  const tripNavRepairAtRef = useRef(0);
  const alongProgressTrackRef = useRef({ alongM: 0, atMs: 0 });
  useEffect(() => {
    alongProgressTrackRef.current = { alongM: 0, atMs: 0 };
  }, [alongHoldResetKey, guidanceRouteId]);
  useEffect(() => {
    if (!navigationStarted || !appForeground) return;
    const runAudit = () => {
      const routeLengthM = guidanceRouteLengthMRef.current;
      const alongM = userAlongGuidanceMRef.current;
      if (routeLengthM <= 1) return;

      const speed = speedMpsRef.current;
      const now = Date.now();
      const track = alongProgressTrackRef.current;
      if (speed != null && speed >= 2.5) {
        if (Math.abs(alongM - track.alongM) >= 25) {
          alongProgressTrackRef.current = { alongM, atMs: now };
        }
      } else {
        alongProgressTrackRef.current = { alongM, atMs: now };
      }
      const alongStaleMs =
        speed != null && speed >= 2.5 ? now - alongProgressTrackRef.current.atMs : 0;

      const focusId = lineFocusId;
      const s = scoredNavHealthRef.current.find((x) => x.route.id === focusId);
      const route = plan.routes.find((r) => r.id === focusId);
      const fullEta = s
        ? Math.round(s.effectiveEtaMinutes)
        : route
          ? Math.round(route.baseEtaMinutes)
          : null;
      const remainingDistanceM = computeRemainingDistanceMeters(
        true,
        routeLengthM,
        alongM
      );
      const remainingEtaMinutes = computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: fullEta,
        routeLengthM,
        alongM,
        hasRouteGeometry: Boolean(guidanceRouteGeomRef.current?.length),
      });

      const audit = auditTripNavDisplay({
        navigationStarted: true,
        routeLengthM,
        alongM,
        fullEtaMinutes: fullEta,
        remainingEtaMinutes,
        remainingDistanceM,
        speedMps: speed,
        alongStaleMs,
      });

      if (audit.ok) return;
      if (now - tripNavRepairAtRef.current < TRIP_NAV_DISPLAY_REPAIR_COOLDOWN_MS) return;
      tripNavRepairAtRef.current = now;
      const actions = repairActionsForIssues(audit.issues);
      for (const action of actions) {
        if (action === "reset_along_hold") setAlongHoldResetKey((k) => k + 1);
        if (action === "refresh_traffic") {
          trafficRefreshRef.current += 1;
          setTrafficRefreshKey(trafficRefreshRef.current);
        }
      }
      reportAppHealthRepair("nav_display", audit.issues, actions);
      if (import.meta.env.DEV) {
        console.info("[nav-health] trip display repair", audit.issues);
      }
    };

    runAudit();
    const id = window.setInterval(runAudit, TRIP_NAV_DISPLAY_POLL_MS);
    return () => window.clearInterval(id);
  }, [navigationStarted, appForeground, lineFocusId, guidanceRouteId, plan.routes]);

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

  /** Strip + map corridors: honor the Road checkbox — do not force “on” in drive (that hid toggles but left layers active). */
  const showTrafficCorridorOnRoute = isPlus && roadAdvisoryDetailOn && settingTrafficEnabled;
  const showRoadNoticesOnRoute = isPlus && roadAdvisoryDetailOn;
  const radarMosaicAlongRoute = useRadarBandsAlongRoute(
    Boolean(radarMapOverlayOn && navigationStarted && guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2),
    guidanceRoute?.geometry
  );

  // ── Tomorrow.io (free tier ~25 req/hr) — split point vs route to stay under quota ──
  const tioApiKey = env.tomorrowIoApiKey;
  const hasPlannedRoute = Boolean(
    destLngLat && plan.routes.some((r) => r.geometry && r.geometry.length >= 2)
  );
  const tioWeatherUiOpen = stormBarExpanded;
  const tioBaseEnabled =
    isPlus && Boolean(tioApiKey) && Boolean(effectiveUserLngLat) && appForeground;
  /** At-your-location minute precip + hourly card — not while driving with the bar collapsed. */
  const tioPointFetchEnabled =
    tioBaseEnabled &&
    (dataSaverMode
      ? tioWeatherUiOpen
      : tioWeatherUiOpen || (!hasPlannedRoute && !navigationStarted));
  /** OpenWeather hourly is fallback only — skip when Tomorrow.io covers the point card. */
  const openWeatherHourlyEnabled = tioPointFetchEnabled && !tioApiKey;
  /** Corridor hourly along the active leg — while navigating or advisory expanded. */
  const tioRouteFetchEnabled =
    tioBaseEnabled &&
    (dataSaverMode
      ? tioWeatherUiOpen
      : tioWeatherUiOpen || navigationStarted);
  const tioMinutePrecip = useTomorrowMinutePrecip(
    tioApiKey,
    effectiveUserLngLat ?? null,
    tioPointFetchEnabled,
    navigationStarted
  );
  const localHourlyForecast = useLocalHourlyForecast(
    tioApiKey,
    env.openWeatherApiKey,
    effectiveUserLngLat ?? null,
    tioPointFetchEnabled,
    openWeatherHourlyEnabled
  );
  const tioRouteForecast = useTomorrowRouteForecast(
    tioApiKey,
    isPlus && guidanceRoute?.geometry?.length ? guidanceRoute.geometry : null,
    speedMps ?? 0,
    tioRouteFetchEnabled
  );

  const advisoryNowcastLine = useMemo(() => {
    if (currentNowcast) return formatNowcastLine(currentNowcast);
    if (tioMinutePrecip?.now) return formatMinutePrecipNowLine(tioMinutePrecip.now);
    return null;
  }, [currentNowcast, tioMinutePrecip?.now]);

  const radarMosaicMaxIntensity = useMemo(() => {
    const s = radarMosaicAlongRoute.samples;
    if (!s.length) return 0;
    return Math.max(...s.map((x) => x.intensity));
  }, [radarMosaicAlongRoute.samples]);

  /** Weather impacts (NWS / heavy radar) on the strip + map are gated by the storm session toggle. */
  const showWeatherImpactsOnRoute =
    advisoryLifeSafetyOn &&
    (advisoryPlusDetailOn ||
      stormCorridorAlerts.length > 0 ||
      radarMosaicMaxIntensity >= RADAR_SOFT_THRESHOLD);

  /** NWS polygons + route bands: corridor alerts that touch or sit ahead of the active leg (~28 mi buffer). */
  const nwsAlertsAffectingActiveRoute = useMemo(() => {
    const g = nwsMapOverlapRouteGeom;
    // No route → nothing is "on your route". Return empty so the advisory panel
    // stays clear and map display falls through to its own independent fallback.
    if (!g?.length) return [] as typeof stormCorridorAlerts;
    return filterAlertsAffectingRoute(g, stormCorridorAlerts);
  }, [stormCorridorAlerts, nwsMapOverlapRouteGeom]);

  /** Polygons containing GPS — surfaced even when the route line misses the geometry. */
  const stormNwsPuckInside = useMemo(() => {
    const p = effectiveUserLngLat;
    if (!p?.length || !stormCorridorAlerts.length) return [];
    const [lng, lat] = p;
    return stormCorridorAlerts.filter(
      (a) => a.geometry && pointInAnyPolygonGeometry(lng, lat, a.geometry)
    );
  }, [effectiveUserLngLat, stormCorridorAlerts]);

  /** Route corridor + at-your-position alerts for advisory timeline and chips. */
  const nwsAlertsForGuidanceAdvisory = useMemo(() => {
    const byId = new Map<string, NormalizedWeatherAlert>();
    for (const a of nwsAlertsAffectingActiveRoute) byId.set(a.id, a);
    for (const a of stormNwsPuckInside) byId.set(a.id, a);
    return sortWeatherAlertsBySeverity([...byId.values()]);
  }, [nwsAlertsAffectingActiveRoute, stormNwsPuckInside]);

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
    /** Map: every alert already fetched for this trip corridor — not only strict polyline hits. */
    const corridorIds = new Set(stormCorridorAlerts.map((a) => a.id));
    const byId = new Map<string, GeoJSON.Feature>();
    if (stormMapGeoJson?.features?.length) {
      for (const f of stormMapGeoJson.features) {
        const id = String((f.properties as { id?: string } | undefined)?.id ?? "");
        if (id && corridorIds.has(id)) byId.set(id, f);
      }
    }
    for (const f of mapGeoJsonFromAlerts(
      stormCorridorAlerts.filter((a) => a.geometry && !byId.has(a.id))
    ).features) {
      const id = String((f.properties as { id?: string } | undefined)?.id ?? "");
      if (id) byId.set(id, f);
    }
    const features = [...byId.values()];
    if (!features.length) return undefined;
    return { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
  }, [stormMapGeoJson, nwsMapOverlapRouteGeom, stormCorridorAlerts]);

  const stormProgressBands = useMemo(() => {
    const g = nwsNavCorridorGeom;
    if (!g?.length) return [];
    const raw = stormMapGeoJsonForMap;
    if (raw === undefined) return [];
    let geo: GeoJSON.FeatureCollection | null = raw;
    if (!advisoryPlusDetailOn && raw.features.length > 0) {
      const filtered = filterMapGeoJsonToBasicEmergencies(raw, stormCorridorAlerts);
      geo = filtered?.features?.length ? filtered : stormCorridorAlerts.length > 0 ? raw : null;
    }
    if (!geo?.features?.length) return [];
    return stormAlongBandsForProgressStrip(g, geo);
  }, [advisoryPlusDetailOn, nwsNavCorridorGeom, nwsNavCorridorGeomKey, stormMapGeoJsonForMap, stormCorridorAlerts]);

  /**
   * Unified Road Ahead model — every surface (drive status, advisory bar, progress rail, map highlights, bypass)
   * reads from the same `RouteImpact[]`, so weather, traffic, closures, and incidents can never disagree.
   */
  const routeImpacts = useMemo<RouteImpact[]>(() => {
    if (!navigationStarted) return [];
    const totalM = guidanceRoute?.geometry?.length ? polylineLengthMeters(guidanceRoute.geometry) : 0;
    return buildRouteImpacts({
      geometry: guidanceRoute?.geometry,
      userLngLat: effectiveUserLngLat,
      userAlongM: totalM > 0 ? userAlongGuidanceM : 0,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes,
      slice: guidanceSlice,
      trafficForRoute: scored.find((s) => s.route.id === lineFocusId),
      trafficLeg: (lineFocusId ? trafficOverlay?.[lineFocusId] : null) ?? null,
      corridorWeatherDetail,
      nwsBands: stormProgressBands.map((b) => ({
        startM: b.startM,
        endM: b.endM,
        severity: b.severity ?? "Moderate",
      })),
      nwsAlerts: nwsAlertsAffectingActiveRoute,
      radarMosaicSamples: radarMosaicAlongRoute.samples,
    });
  }, [
    navigationStarted,
    guidanceRoute?.geometry,
    guidanceRoute?.baseEtaMinutes,
    effectiveUserLngLat,
    userAlongGuidanceM,
    guidanceSlice,
    scored,
    lineFocusId,
    trafficOverlay,
    corridorWeatherDetail,
    stormProgressBands,
    nwsAlertsAffectingActiveRoute,
    radarMosaicAlongRoute.samples,
  ]);

  /** Filter impacts by the same UI toggles that gated the legacy alert list. */
  const routeImpactsForUi = useMemo(() => {
    return routeImpacts.filter((i) => {
      if (i.category === "traffic") return showTrafficCorridorOnRoute;
      if (i.category === "closure" || i.category === "incident" || i.category === "construction") {
        return showRoadNoticesOnRoute;
      }
      // Weather impacts (NWS / radar) — gated by storm session detail.
      return showWeatherImpactsOnRoute;
    });
  }, [routeImpacts, showTrafficCorridorOnRoute, showRoadNoticesOnRoute, showWeatherImpactsOnRoute]);

  /** Advisory panel: impacts ordered like the progress rail (nearest first). Carries the full
   *  RouteImpact fields the bar needs to split rows by source/category and to slot severe NWS
   *  bands into the storm strip (source-attribution + start/end-meters). */
  const advisoryRouteImpacts = useMemo(() => {
    const base = [...routeImpactsForUi];

    // Merge Tomorrow.io hourly forecast impacts (Plus only, when route is active).
    if (tioRouteForecast && guidanceRoute?.geometry && guidanceRouteLengthM > 0) {
      const planEta = guidanceRoute.baseEtaMinutes ?? null;
      if (planEta && planEta > 0) {
        const tioImpacts = routeForecastToImpacts(
          tioRouteForecast,
          guidanceRoute.geometry,
          planEta,
          guidanceRouteLengthM
        );
        base.push(...tioImpacts);
      }
    }

    return base.sort((a, b) => {
      const da = a.distanceAheadMeters ?? a.alongMeters;
      const db = b.distanceAheadMeters ?? b.alongMeters;
      return da - db;
    });
  }, [routeImpactsForUi, tioRouteForecast, guidanceRoute?.geometry, guidanceRoute?.baseEtaMinutes, guidanceRouteLengthM]);

  /** Severe / extreme NWS warnings that cross the active route, projected to a storm-strip band.
   *  We pair each NWS-source impact with its raw alert (by id) so the strip caption can show the
   *  expiration time, which is on the NWS alert and not duplicated on the impact. */
  const advisoryStormStripBands = useMemo(() => {
    const totalM = guidanceRouteLengthM;
    if (totalM <= 0 || !nwsAlertsForGuidanceAdvisory.length) return [] as Array<{
      id: string; event: string;
      severity: "info" | "caution" | "serious" | "avoid";
      startMeters: number; endMeters: number;
      expiresIso: string | null; alertId: string | null;
      crossesRoute: boolean;
    }>;

    const routeGeom = guidanceRoute?.geometry ?? nwsNavCorridorGeom;
    if (!routeGeom?.length) return [];

    const bands: Array<{
      id: string; event: string;
      severity: "info" | "caution" | "serious" | "avoid";
      startMeters: number; endMeters: number;
      expiresIso: string | null;
      alertId: string | null;
      crossesRoute: boolean;
    }> = [];

    const NEARBY_HALF_M = 8_000; // strip half-width for near-but-not-crossing alerts

    for (const alert of nwsAlertsForGuidanceAdvisory) {
      const rawSev = alert.severity ?? "Moderate";
      const sev: "info" | "caution" | "serious" | "avoid" =
        rawSev === "Extreme" ? "avoid"
        : rawSev === "Severe" ? "serious"
        : rawSev === "Moderate" ? "caution"
        : "info";

      let startM: number;
      let endM: number;
      let crossesRoute: boolean;

      if (alert.geometry) {
        const intersection = alertRouteIntersectionMeters(routeGeom, alert.geometry);
        if (intersection) {
          startM = intersection.startM;
          endM = intersection.endM;
          crossesRoute = true;
        } else {
          /* Alert is near the route (NWS buffer) but doesn't cross — place a representative
           * strip at the closest route point to the polygon centroid. */
          const centroid = polygonApproxCentroid(alert.geometry);
          const midM = closestAlongMeters(routeGeom, centroid as [number, number]);
          startM = Math.max(0, midM - NEARBY_HALF_M);
          endM = Math.min(totalM, midM + NEARBY_HALF_M);
          crossesRoute = false;
        }
      } else {
        /* No geometry at all — spread across full route as a last-resort placeholder. */
        startM = 0;
        endM = totalM;
        crossesRoute = false;
      }

      bands.push({
        id: `nws-alert-${alert.id}`,
        event: alert.event ?? "Weather Alert",
        severity: sev,
        startMeters: startM,
        endMeters: endM,
        expiresIso: alert.ends ?? null,
        alertId: alert.id ?? null,
        crossesRoute,
      });
    }

    return bands;
  }, [
    nwsAlertsForGuidanceAdvisory,
    guidanceRouteLengthM,
    guidanceRoute?.geometry,
    nwsNavCorridorGeom,
  ]);

  /**
   * Project unified impacts back to the legacy `RouteAlert` shape so existing surfaces (progress strip,
   * map highlights, corridor sheet) keep working unchanged.
   *
   * NWS-source weather impacts are drawn elsewhere as `stormProgressBands` / map polygons, so we drop
   * them from the corridor list to avoid double-drawing the same area in two color systems.
   * Radar-source weather impacts pass through — fixing the prior mismatch where heavy rain on the
   * route was silently filtered out of the progress strip.
   */
  const routeAlerts = useMemo(
    () => routeImpactsForUi.map(routeImpactToRouteAlert),
    [routeImpactsForUi]
  );

  const trafficBypassContext = useMemo(
    () => computeTrafficBypassOffer(routeImpactsForUi, trafficDelayMinutesForBypass),
    [routeImpactsForUi, trafficDelayMinutesForBypass]
  );

  const showTrafficBypassCta =
    navigationStarted &&
    Boolean(
      env.mapboxToken &&
        destLngLat &&
        guidanceRoute?.geometry?.length &&
        isPlus &&
        roadAdvisoryDetailOn &&
        settingTrafficEnabled
    ) &&
    trafficBypassContext != null &&
    !trafficBypassCompare;

  /** Dr: only the chosen (focused) leg on the map — alternates stay in Rt / Map views. */
  const driveMapRoutes = useMemo(() => {
    if (trafficBypassCompare || viewMode !== "drive") return plan.routes;
    const active = plan.routes.find((r) => r.id === guidanceRouteId);
    if (active) return [active];
    return plan.routes.length ? [plan.routes[0]!] : [];
  }, [trafficBypassCompare, viewMode, guidanceRouteId, plan.routes]);
  const progressRailRoute = guidanceRoute ?? driveMapRoutes[0] ?? plan.routes[0];

  const postedMph = estimatePostedSpeedMph(speedMph, turnSteps, activeTurnIndex);

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
    const mph = postedMph > 0 ? postedMph : 35;
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

  const progressStripAlerts = useMemo(() => augmentAlertsForProgressStrip(routeAlerts), [routeAlerts]);

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
    return progressStripAlerts;
  }, [progressStripAlerts, guidanceRoute?.geometry]);

  /**
   * NWS warning polygons on the map for the active leg (Rt / Dr / Map). Independent of radar overlay.
   * Shown whenever Storm is enabled and alerts touch the route corridor — not gated on view mode
   * (after Go the UI is usually Dr, which previously hid all polygons).
   */
  const nwsAlertGeoJsonForMap = useMemo((): GeoJSON.FeatureCollection | null => {
    // Hard gates: feature flag + user NWS toggle.
    if (!advisoryLifeSafetyOn || !settingStormEnabled) return null;

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
    nwsMapOverlapRouteGeom,
    stormMapGeoJsonForMap,
    nwsAlertsAffectingActiveRoute,
    stormCorridorAlerts,
    stormMapGeoJson,
  ]);

  /** Drive HUD: unified Road Ahead — same RouteImpact list as map / strip / bypass. */
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

  /**
   * Route broken into distance/time chunks (start at bottom of panel, destination toward top).
   * Long legs: sliding window follows `userAlongM` so older segments scroll away as you drive.
   */
  const progressCalloutPanel = useMemo((): {
    routeWide: RouteChunkCalloutItem[];
    outlookTimeline: RouteOutlookStep[];
    segments: RouteChunkCalloutItem[];
    userAlongT: number;
    stripTint: string;
  } => {
    const g = guidanceRoute?.geometry;
    const stripTint =
      guidanceRoute != null
        ? navigationStarted
          ? routePickSlotHex(0)
          : routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds))
        : "#94a3b8";

    if (!g?.length) {
      return { routeWide: [], outlookTimeline: [], segments: [], userAlongT: 0, stripTint };
    }
    const totalM = polylineLengthMeters(g);
    if (totalM <= 0) {
      return { routeWide: [], outlookTimeline: [], segments: [], userAlongT: 0, stripTint };
    }
    const userAlongT =
      totalM > 0 ? Math.min(1, Math.max(0, userAlongGuidanceM / totalM)) : 0;

    if (!navigationStarted) {
      const pt = totalM > 0 ? Math.min(1, Math.max(0, userAlongGuidanceM / totalM)) : 0.5;
      const b = buildSimpleCalloutBlock("Route conditions", [
        "Open Rt view for NWS warning polygons on the map.",
        "Press Go for live traffic and segment labels on the strip.",
      ]);
      return {
        routeWide: [],
        outlookTimeline: [],
        segments: [
          {
            key: "callout-pre-go",
            scope: "segment",
            title: b.title,
            summary: b.summary,
            tooltip: b.tooltip,
            color: stripTint,
            alongT: pt,
            alongPct: Math.round(pt * 100),
          },
        ],
        userAlongT,
        stripTint,
      };
    }

    const laidOut = layoutStripAlerts(progressStripAlerts, g, userAlongGuidanceM, totalM);
    const planEta = guidanceRoute?.baseEtaMinutes ?? null;
    const wxSamples = weatherOverlay?.[guidanceRouteId]?.samples;

    const bundle = buildRouteChunkCalloutList({
      geometry: g,
      totalM,
      userAlongM: userAlongGuidanceM,
      planEtaMinutes: planEta,
      slice: guidanceSlice,
      weatherSamples: wxSamples,
      laidOutAlerts: laidOut,
      stormBands: stormProgressBands,
      stripTint,
      stormNwsAlerts: nwsAlertsAffectingActiveRoute,
      progressTrafficLine: liveTrafficNarrative?.progressStartLine ?? null,
    });

    if (bundle.routeWide.length > 0 || bundle.outlookTimeline.length > 0 || bundle.segments.length > 0) {
      return { ...bundle, userAlongT, stripTint };
    }

    const pt = totalM > 0 ? Math.min(1, Math.max(0, userAlongGuidanceM / totalM)) : 0.5;
    const hasStormUi =
      Boolean(stormProgressBands?.length) ||
      Boolean(stormCorridorAlerts?.length) ||
      Boolean(progressStripAlerts?.length);
    const b = buildSimpleCalloutBlock(
      "Route conditions",
      hasStormUi
        ? ["NWS active — open Rt view for warning polygons on the map."]
        : ["No corridor alerts yet — check Storm is on in Settings."]
    );
    return {
      routeWide: [],
      outlookTimeline: [],
      segments: [
        {
          key: "callout-fallback",
          scope: "segment",
          title: b.title,
          summary: b.summary,
          tooltip: b.tooltip,
          color: stripTint,
          alongT: pt,
          alongPct: Math.round(pt * 100),
        },
      ],
      userAlongT,
      stripTint,
    };
  }, [
    navigationStarted,
    guidanceRoute,
    orderedRouteIds,
    guidanceRoute?.geometry,
    guidanceRoute?.baseEtaMinutes,
    guidanceRouteId,
    userAlongGuidanceM,
    stormProgressBands,
    stormCorridorAlerts,
    progressStripAlerts,
    guidanceSlice,
    weatherOverlay,
    liveTrafficNarrative,
  ]);

  const progressCalloutCount =
    progressCalloutPanel.routeWide.length +
    (progressCalloutPanel.outlookTimeline.length > 0 ? 1 : 0) +
    progressCalloutPanel.segments.length;

  /** Open panel with “Start route” at the bottom of the scroll area (list reads ahead toward the top). */
  useLayoutEffect(() => {
    const wasOpen = progressCalloutWasOpenRef.current;
    progressCalloutWasOpenRef.current = progressCalloutsOpen;
    if (progressCalloutsOpen && !wasOpen && progressCalloutCount > 0) {
      const el = progressCalloutTrackRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
  }, [progressCalloutsOpen, progressCalloutCount]);

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
    if (!settingStormEnabled) {
      // Ensure we stop storm polling immediately.
      stormMapHasDisplayableRef.current = false;
      setStormLoading(false);
      setStormError(null);
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormBarExpanded(false);
    }
  }, [settingStormEnabled]);

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

  useEffect(() => {
    stormMapHasDisplayableRef.current =
      Boolean(stormMapGeoJson?.features?.length) || stormCorridorAlerts.length > 0;
  }, [stormMapGeoJson, stormCorridorAlerts.length]);

  /**
   * US NWS: starts once A/B/C polylines exist (same time as route preview). Merges corridor results for
   * every planned leg. Traffic stays gated on Go elsewhere. If there is no trip yet, falls back to GPS
   * viewport browse (same as empty-map storm context).
   */
  useEffect(() => {
    if (!appForeground) return;
    /** NWS is not Plus-gated — Basic still needs life-safety alerts; UI filters detail elsewhere. */
    if (!env.stormAdvisoryEnabled || !advisoryLifeSafetyOn) {
      if (import.meta.env.DEV) console.error("[NWS] BLOCKED gate1 stormAdvisoryEnabled=", env.stormAdvisoryEnabled, "lifeSafetyOn=", advisoryLifeSafetyOn);
      stormMapHasDisplayableRef.current = false;
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormError(null);
      setStormLoading(false);
      return;
    }
    /** Matches Settings → Storm; sibling effect clears state when this turns off — do not poll NWS. */
    if (!settingStormEnabled) {
      if (import.meta.env.DEV) console.error("[NWS] BLOCKED gate2 settingStormEnabled=false");
      setStormLoading(false);
      return;
    }
    /**
     * Do not gate NWS on `navigator.onLine`. WKWebView / iOS often misreports offline while Mapbox and
     * HTTPS APIs still work; blocking here showed “no NWS” forever on some devices.
     */

    const routeGeoms = nwsRouteGeomsForFetchRef.current;
    const hasRouteCorridors = routeGeoms.length > 0;
    const canBrowseWithoutRoutes = !hasRouteCorridors && Boolean(effectiveUserLngLat);

    if (import.meta.env.DEV) {
      console.log(
        "[NWS] effect:",
        "stableKey=",
        nwsEffectStableKey,
        "withGeom=",
        routeGeoms.length,
        "hasCorridors=",
        hasRouteCorridors
      );
    }

    if (!hasRouteCorridors && !canBrowseWithoutRoutes) {
      if (import.meta.env.DEV) console.debug("[NWS] skipped: no route yet and no GPS fix");
      if (planRef.current.routes.length === 0) {
        stormMapHasDisplayableRef.current = false;
        setStormMapGeoJson(null);
        setStormCorridorAlerts([]);
        setStormOverlapping([]);
        setStormError(null);
      }
      setStormLoading(false);
      return;
    }

    const genAtStart = ++nwsFetchGenRef.current;
    let cancelled = false;
    /** If primary routing is still computing, retry soon instead of waiting for the 120s interval. */
    let routingRetryTimer: number | null = null;

    const run = async () => {
      if (nwsFetchGenRef.current !== genAtStart) { if (import.meta.env.DEV) console.log("[NWS run] stale gen"); return; }
      if (nwsFetchInFlightRef.current) {
        /* Another fetch is still running; wait for it to finish rather than pile up timers. */
        if (routingRetryTimer == null) {
          routingRetryTimer = window.setTimeout(() => {
            routingRetryTimer = null;
            if (!cancelled && nwsFetchGenRef.current === genAtStart) void run();
          }, 600);
        }
        return;
      }
      const geomsForRun = nwsRouteGeomsForFetchRef.current;
      if (routingRef.current && geomsForRun.length === 0) {
        if (import.meta.env.DEV) console.log("[NWS run] primary routing in progress, retry 1.2s");
        routingRetryTimer = window.setTimeout(() => {
          routingRetryTimer = null;
          if (!cancelled && nwsFetchGenRef.current === genAtStart) void run();
        }, 1200);
        return;
      }
      if (import.meta.env.DEV) console.log("[NWS run] fetching...");
      nwsFetchInFlightRef.current = true;
      const hasPriorNws =
        stormMapHasDisplayableRef.current || stormCorridorAlertsRef.current.length > 0;
      if (!hasPriorNws) setStormLoading(true);
      setStormError(null);

      try {
        const geoms = geomsForRun;

        if (geoms.length > 0) {
          const { result: merged, partialErrors } = await fetchNwsAlertsForRouteCorridorsMerged(
            geoms,
            NWS_REQUEST_USER_AGENT,
            {
              onBeforeUgc: (partial) => {
                if (cancelled || nwsFetchGenRef.current !== genAtStart) return;
                if (!partial.alerts.length && !partial.mapGeoJson.features.length) return;
                setStormCorridorAlerts(partial.alerts);
                setStormMapGeoJson(partial.mapGeoJson);
              },
            }
          );
          if (import.meta.env.DEV && partialErrors?.length) {
            console.warn("[StormPath NWS] Some route legs failed (others merged):", partialErrors);
          }
          if (cancelled || nwsFetchGenRef.current !== genAtStart) return;
          setStormCorridorAlerts(merged.alerts);
          setStormMapGeoJson(merged.mapGeoJson);
          if (import.meta.env.DEV) {
            console.log(
              "[NWS fetch] alerts:", merged.alerts.length,
              "mapFeatures:", merged.mapGeoJson.features.length,
              merged.alerts.map((a) => `${a.event} (geom:${Boolean(a.geometry)})`).join(", ")
            );
          }
          const overlappingIds = new Set<string>();
          for (const g of geoms) {
            const o = computeRouteOverlapWithAlerts(g, merged.alerts);
            for (const id of o.overlappingIds) overlappingIds.add(id);
          }
          setStormOverlapping(merged.alerts.filter((a) => overlappingIds.has(a.id)));
        } else {
          const p = effectiveUserLngLatRef.current;
          if (!p) {
            if (!cancelled && nwsFetchGenRef.current === genAtStart) {
              setStormCorridorAlerts([]);
              setStormMapGeoJson(null);
              setStormOverlapping([]);
              setStormError(null);
            }
            return;
          }
          const [lng, lat] = p;
          const bounds = nwsBrowseBoundsAroundLngLat(lng, lat);
          const corridor = await fetchNwsAlertsForBrowseViewport(bounds, NWS_REQUEST_USER_AGENT);
          if (cancelled || nwsFetchGenRef.current !== genAtStart) return;
          setStormCorridorAlerts(corridor.alerts);
          setStormMapGeoJson(corridor.mapGeoJson);
          const atUser = corridor.alerts.filter(
            (a) => a.geometry && pointInAnyPolygonGeometry(lng, lat, a.geometry)
          );
          setStormOverlapping(atUser);
        }
      } catch (e) {
        if (!cancelled && nwsFetchGenRef.current === genAtStart) {
          setStormError(e instanceof Error ? e.message : String(e));
          if (!stormCorridorAlertsRef.current.length) {
            setStormMapGeoJson(null);
            setStormCorridorAlerts([]);
            setStormOverlapping([]);
          }
        }
      } finally {
        nwsFetchInFlightRef.current = false;
        setStormLoading(false);
      }
    };
    void run();
    const id = window.setInterval(run, nwsPollIntervalMs);
    return () => {
      cancelled = true;
      if (routingRetryTimer != null) window.clearTimeout(routingRetryTimer);
      nwsFetchGenRef.current += 1;
      window.clearInterval(id);
      setStormLoading(false);
    };
  }, [
    appForeground,
    env.stormAdvisoryEnabled,
    nwsEffectStableKey,
    nwsPollIntervalMs,
    advisoryLifeSafetyOn,
    settingStormEnabled,
    plan.routes.length,
    // `routing` is intentionally excluded — reading it via routingRef.current inside run()
    // so the effect is not torn down every time routing completes (which would cancel
    // in-progress zone resolution and restart the fetch indefinitely).
    nwsBrowseLocationReady,
  ]);

  /**
   * The blue line is ORS/OpenStreetMap; traffic delay comes from Mapbox along that shape. Closures
   * can show as huge delay while the line still crosses the barricade. Snap the active leg to Mapbox
   * driving-traffic geometry when delay is extreme or Mapbox can’t trace the ORS polyline.
   */
  useEffect(() => {
    if (!navigationStarted || !env.mapboxToken || !destLngLat || !guidanceRoute) return;
    if (!trafficFetchDone || routing) return;

    const leg = trafficOverlay?.[lineFocusId];
    if (leg === undefined) return;

    const alreadyMb =
      guidanceRoute.routeNotices?.some(
        (n) =>
          n.includes(MB_TRAFFIC_LINE_SNAP_NOTICE) ||
          n.includes("Traffic-aware path from current position (Mapbox)")
      ) ?? false;
    if (alreadyMb) return;

    const broken = leg === null;
    const heavy = leg != null && leg.delayVsTypicalMinutes >= MAPBOX_LINE_SNAP_DELAY_MIN;
    if (!broken && !heavy) return;

    const now = Date.now();
    if (now - lastMbLineSnapMsRef.current < MAPBOX_LINE_SNAP_COOLDOWN_MS) return;

    let cancelled = false;
    lastMbLineSnapMsRef.current = now;
    const epochAtStart = routeGraphEpochRef.current;

    void (async () => {
      const pos = userLngLatRef.current;
      if (!pos || cancelled) return;
      const mb = await fetchMapboxDrivingTrafficRoute(env.mapboxToken, pos, destLngLat);
      if (cancelled || !mb) return;
      if (epochAtStart !== routeGraphEpochRef.current) return;
      setPlan((prev) => ({
        ...prev,
        routes: prev.routes.map((r) =>
          r.id === lineFocusId
            ? {
                ...r,
                geometry: mb.geometry,
                baseEtaMinutes: Math.max(1, Math.round(mb.durationMinutes)),
                turnSteps: mb.turnSteps,
                routeNotices: [
                  ...(r.routeNotices ?? []),
                  `${MB_TRAFFIC_LINE_SNAP_NOTICE} — follows live road network when ORS can’t match closures/congestion.`,
                ],
              }
            : r
        ),
      }));
      setFitTrigger((n) => n + 1);
      setTapHint(
        broken
          ? "Route line switched to Mapbox roads — the old line may cross a closure or bad segment."
          : "Route line updated to match heavy traffic on the map."
      );
      window.setTimeout(() => setTapHint(null), 6500);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    navigationStarted,
    env.mapboxToken,
    destLngLat,
    guidanceRoute,
    trafficFetchDone,
    trafficOverlay,
    lineFocusId,
    routing,
  ]);

  useEffect(() => {
    seriousHazardAutoFlewRef.current.clear();
  }, [guidanceRouteId]);

  useEffect(() => {
    offRouteLatchedRef.current = false;
  }, [guidanceRouteId]);

  /** Lateral distance near last on-route position — reroute ~100 ft off the corridor. */
  useEffect(() => {
    if (!navigationStarted || !guidanceRoute?.geometry?.length || !destLngLat) {
      offRouteLatchedRef.current = false;
      lastOffRouteSampleRef.current = null;
      setOffRouteSevere(false);
      return;
    }

    const tick = () => {
      const pos = userLngLatRef.current;
      const geom = guidanceRouteGeomRef.current;
      if (!pos || !geom?.length) return;

      const totalM =
        guidanceRouteLengthMRef.current > 0
          ? guidanceRouteLengthMRef.current
          : polylineLengthMeters(geom);
      const sample = measureOffRouteLateral(pos, geom, userAlongGuidanceMRef.current);
      const lat = sample.lateralM;
      const alongM = sample.alongM;
      const now = Date.now();

      const nearingEnd = totalM > 0 && alongM > totalM - 45;
      if (nearingEnd) {
        offRouteLatchedRef.current = false;
        setOffRouteSevere(false);
        lastOffRouteSampleRef.current = null;
        return;
      }

      lastOffRouteSampleRef.current = { t: now, lateralM: lat, alongM };

      if (offRouteLatchedRef.current) {
        if (shouldExitOffRouteLatch(lat)) {
          offRouteLatchedRef.current = false;
          setOffRouteSevere(false);
        }
      } else if (shouldTriggerOffRouteReroute(lat)) {
        offRouteLatchedRef.current = true;
        setOffRouteSevere(true);
      }

      if (
        !settingAutoRerouteEnabled ||
        routingRef.current ||
        altRoutesRefreshInFlightRef.current ||
        (env.mapboxToken && !isOnline)
      ) {
        return;
      }

      if (!shouldTriggerOffRouteReroute(lat)) return;
      if (now - lastSevereAutoRecalcMsRef.current < NAV_SEVERE_OFF_ROUTE_THROTTLE_MS) return;

      lastSevereAutoRecalcMsRef.current = now;
      void recalcRouteFromHere({ silent: true });
    };

    tick();
    const id = window.setInterval(tick, OFF_ROUTE_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    navigationStarted,
    guidanceRoute?.geometry,
    guidanceRouteLengthM,
    destLngLat,
    recalcRouteFromHere,
    routing,
    settingAutoRerouteEnabled,
    env.mapboxToken,
    isOnline,
    userLngLat,
  ]);

  const refreshAltRef = useRef(refreshAlternateRoutesOnly);
  refreshAltRef.current = refreshAlternateRoutesOnly;

  const refreshStormAwareRoutesRef = useRef(refreshStormAwareRoutes);
  refreshStormAwareRoutesRef.current = refreshStormAwareRoutes;

  /** Debounced reroute when storm mass moves along the corridor or you cross an avoidance boundary. */
  useEffect(() => {
    if (!stormAdaptiveSig) return;
    const t = window.setTimeout(() => {
      void refreshStormAwareRoutesRef.current();
    }, STORM_ADAPT_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [stormAdaptiveSig]);

  /** Rt: keep primary leg fixed; refresh alternate legs on an interval */
  useEffect(() => {
    if (!appForeground) return;
    if (!navigationStarted) return;
    if (viewMode !== "route") return;
    if (!destLngLat) return;
    const altMs = getNavAltRefreshMs(dataSaverMode);
    if (altMs == null) return;
    const id = window.setInterval(() => {
      if (routingRef.current || altRoutesRefreshInFlightRef.current) return;
      void refreshAltRef.current();
    }, altMs);
    return () => window.clearInterval(id);
  }, [appForeground, navigationStarted, viewMode, destLngLat, dataSaverMode]);

  useEffect(() => {
    if (!navigationStarted || viewMode !== "drive") return;
    if (!guidanceRoute?.geometry?.length || !userLngLat) return;
    /* Auto fly-to a serious upcoming impact (storm, closure, blocked crash). Reads from the unified
     * impact list so weather is included alongside road incidents — earlier picks were RouteAlert-only and
     * missed serious NWS warnings. */
    const candidate = routeImpactsForUi.find(
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
  }, [navigationStarted, viewMode, guidanceRoute?.geometry, guidanceRouteId, userLngLat, routeImpactsForUi]);

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

  /** Advisory strip always available for Plus life-safety; Basic follows Storm setting. */
  const showStormAdvisoryChrome = advisoryLifeSafetyOn;

  const showProgressRail =
    navigationStarted &&
    isPlus &&
    !trafficBypassCompare &&
    Boolean(progressRailRoute?.geometry && progressRailRoute.geometry.length >= 2);

  /** Matches map: planning uses A/B/C preview; after Go the active leg reads as primary blue. */
  const progressStripRouteColor = useMemo(() => {
    if (!guidanceRoute) return routePickSlotHex(0);
    if (navigationStarted) return routePickSlotHex(0);
    return routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds));
  }, [guidanceRoute, orderedRouteIds, navigationStarted]);

  const showOffRouteManualBanner =
    offRouteSevere &&
    navigationStarted &&
    viewMode !== "drive" &&
    !settingAutoRerouteEnabled;

  const radarFrameTimeLabel = useMemo(() => {
    if (!radarMapOverlayOn || radarFrameUtcSec == null) return null;
    /* Frame `time` is a UTC instant; show local wall time so it matches the user’s clock. */
    return new Date(radarFrameUtcSec * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [radarMapOverlayOn, radarFrameUtcSec]);

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
    routeGraphEpochRef.current += 1;
    routeMainFetchAbortRef.current?.abort();
    routeMainFetchAbortRef.current = null;
    altRoutesFetchAbortRef.current?.abort();
    altRoutesFetchAbortRef.current = null;
    setProgressCalloutsOpen(false);
    setPlan(EMPTY_TRIP);
    setDestLngLat(null);
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

  const arrivalHintShownRef = useRef(false);

  /** Bump on chrome input — resets arrival idle countdown (map pan/zoom does not). */
  useEffect(() => {
    const bump = (e: Event) => {
      if (!shouldResetArrivalIdleOnPointer(e.target)) return;
      lastUserInteractionMsRef.current = Date.now();
      arrivalIdleStartMsRef.current = null;
      arrivalHintShownRef.current = false;
    };
    const opts: AddEventListenerOptions = { capture: true };
    window.addEventListener("pointerdown", bump, opts);
    window.addEventListener("keydown", bump, opts);
    window.addEventListener("touchstart", bump, opts);
    return () => {
      window.removeEventListener("pointerdown", bump, opts);
      window.removeEventListener("keydown", bump, opts);
      window.removeEventListener("touchstart", bump, opts);
    };
  }, []);

  useEffect(() => {
    const ARRIVAL_TICK_MS = 4000;
    const runArrivalClear = () => {
      if (demoBypassTrafficJamPlusRef.current) return;
      arrivalIdleStartMsRef.current = null;
      arrivalHintShownRef.current = false;
      tabHiddenAtMsRef.current = null;
      clearRouteRef.current();
      setTapHint("You've arrived — trip cleared.");
      window.setTimeout(() => setTapHint(null), 5000);
    };
    const tick = () => {
      if (demoBypassTrafficJamPlusRef.current) return;
      if (!navigationStartedRef.current) {
        arrivalIdleStartMsRef.current = null;
        arrivalHintShownRef.current = false;
        return;
      }
      const pos = userLngLatRef.current;
      const dest = destLngLatRef.current;
      if (!pos || !dest) {
        arrivalIdleStartMsRef.current = null;
        arrivalHintShownRef.current = false;
        return;
      }
      const prox = arrivalProximity({
        pos,
        dest,
        routeGeometry: guidanceRouteGeomRef.current,
        alongRouteM: userAlongGuidanceMRef.current,
        routeLengthM: guidanceRouteLengthMRef.current,
      });
      if (!prox.near) {
        arrivalIdleStartMsRef.current = null;
        arrivalHintShownRef.current = false;
        return;
      }
      if (!isStationaryForArrival(speedMpsRef.current)) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const now = Date.now();
      if (now - lastUserInteractionMsRef.current < 2500) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const idleMs = arrivalIdleClearMs(prox.remainingAlongM);
      if (arrivalIdleStartMsRef.current == null) {
        arrivalIdleStartMsRef.current = now;
        if (!arrivalHintShownRef.current) {
          arrivalHintShownRef.current = true;
          setTapHint("Near destination — trip clears shortly when you stop.");
          window.setTimeout(() => setTapHint(null), 6500);
        }
        return;
      }
      if (now - arrivalIdleStartMsRef.current >= idleMs) {
        runArrivalClear();
      }
    };
    const id = window.setInterval(tick, ARRIVAL_TICK_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        tabHiddenAtMsRef.current = Date.now();
        return;
      }
      if (demoBypassTrafficJamPlusRef.current) return;
      const hiddenAt = tabHiddenAtMsRef.current;
      if (hiddenAt == null) return;
      const bgMs = Date.now() - hiddenAt;
      tabHiddenAtMsRef.current = null;
      if (bgMs < ARRIVAL_BG_CLEAR_MIN_MS) return;
      const pos = userLngLatRef.current;
      const dest = destLngLatRef.current;
      if (!navigationStartedRef.current || !pos || !dest) return;
      const prox = arrivalProximity({
        pos,
        dest,
        routeGeometry: guidanceRouteGeomRef.current,
        alongRouteM: userAlongGuidanceMRef.current,
        routeLengthM: guidanceRouteLengthMRef.current,
      });
      if (!prox.near) return;
      if (!isStationaryForArrival(speedMpsRef.current)) return;
      runArrivalClear();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /** Route view / cycle: only change which leg is previewed (A/B/C colors stay on fixed slots). */
  const handlePreviewRouteSelect = useCallback(
    (id: string) => {
      if (!plan.routes.some((r) => r.id === id)) return;
      const i = orderedRouteIds.indexOf(id);
      if (i >= 0) setPreviewLegIndex(i);
      if (navigationStarted && viewMode === "route") {
        setRouteSlotOrder((prev) => slotOrderAfterSelect(prev.length ? prev : planRouteIds, id));
        setPreviewLegIndex(0);
      }
      if (!navigationStarted || viewMode === "route") setFitTrigger((n) => n + 1);
    },
    [plan.routes, orderedRouteIds, navigationStarted, viewMode, planRouteIds]
  );

  /** Make this leg the primary (slot A / blue); used after Go, hazard “use this route”, and bypass. */
  const handlePromoteRouteToPrimary = useCallback(
    (id: string) => {
      if (!plan.routes.some((r) => r.id === id)) return;
      setRouteSlotOrder((prev) => slotOrderAfterSelect(prev.length ? prev : planRouteIds, id));
      setPreviewLegIndex(0);
    },
    [plan.routes, planRouteIds]
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
    activateRouteCompare({
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
    });
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

    const pickedForNav = plan.routes.find((r) => r.id === chosen);
    navGoStartedAtRef.current = Date.now();
    navGoGeometryRef.current = pickedForNav?.geometry?.length
      ? pickedForNav.geometry.map(([a, b]) => [a, b] as LngLat)
      : null;

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
    }
  }, [tollRoutePrompt, proceedGo]);

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
    setTrafficBypassCompare(null);
    setViewModeBeforeTrafficBypass(null);
    setViewMode("drive");
    setFitTrigger((n) => n + 1);
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
    setDriveMapBearingDeg(deg);
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
      return {
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
      };
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

  const handleProgressStripCorridorClick = useCallback((alert: RouteAlert) => {
    if (!lineFocusId) return;
    setRouteHazardSheet({
      routeId: lineFocusId,
      alerts: [alert],
    });
  }, [lineFocusId]);

  const handleProgressStripStormClick = useCallback(
    (startM: number, endM: number) => {
      const geom = guidanceRoute?.geometry;
      if (!geom?.length) {
        return;
      }
      const pool =
        stormOverlapping.length > 0 ? stormOverlapping : stormCorridorAlerts;
      const picked = routeAlertsFromStormBandMidpoint(geom, startM, endM, pool);
      if (!picked.length) return;
      setRouteHazardSheet({
        routeId: lineFocusId,
        alerts: picked,
      });
    },
    [guidanceRoute?.geometry, stormOverlapping, stormCorridorAlerts, lineFocusId]
  );

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

  const handleTrafficBypassFromHere = useCallback(async (opts?: {
    /** Override the jam anchor (m along route). Used by demo paths that need a deterministic point. */
    anchorAlongMeters?: number;
    /** Override the lng/lat shown for the hazard pin. Falls back to the route geometry at the anchor. */
    anchorLngLat?: LngLat;
  }) => {
    if (!isPlus) return;
    const originLngLat =
      demoBypassTrafficJamPlus && effectiveUserLngLat ? effectiveUserLngLat : userLngLat;
    if (!env.mapboxToken || !originLngLat || !destLngLat || !guidanceRoute?.geometry?.length) return;
    const epochAtStart = routeGraphEpochRef.current;
    setBypassBusy(true);
    const geom = guidanceRoute.geometry;
    const totalM = polylineLengthMeters(geom);

    const anchorImpact = opts?.anchorAlongMeters == null
      ? pickTrafficBypassAnchorImpact(routeImpactsForUi)
      : null;
    const jamAlongM =
      opts?.anchorAlongMeters ??
      anchorImpact?.alongMeters ??
      Math.min(
        totalM - 50,
        userAlongGuidanceM + Math.max(600, (totalM - userAlongGuidanceM) * 0.32)
      );
    const hazardLngLat =
      opts?.anchorLngLat ?? anchorImpact?.lngLat ?? pointAtAlongMeters(geom, jamAlongM);
    const compareHeadline =
      trafficBypassContext?.headline ?? "Three routes from here to your destination";

    try {
      /* Same A/B/C builder as initial Go — three distinct end-to-end lines, not surgical splices
       * on the current leg (those looked like one route with tiny forks). */
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
          confidence: trafficBypassContext?.confidence ?? "medium",
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

      activateRouteCompare({
        headline: compareHeadline,
        etaA,
        etaB: etaFor("r-b"),
        etaC: etaFor("r-c"),
        hasB: Boolean(byId.get("r-b")?.geometry && byId.get("r-b")!.geometry.length >= 2),
        hasC: Boolean(byId.get("r-c")?.geometry && byId.get("r-c")!.geometry.length >= 2),
        confidence: trafficBypassContext?.confidence ?? "medium",
        selectedLeg: defaultRouteCompareSelection(guidanceRouteId),
        hazardLngLat,
        hazardAlongMeters: jamAlongM,
      });
    } catch {
      const opened = openRouteCompareFromPlan({
        headline: compareHeadline,
        hazardLngLat,
        hazardAlongMeters: jamAlongM,
        confidence: trafficBypassContext?.confidence ?? "medium",
      });
      if (!opened) {
        setViewModeBeforeTrafficBypass(null);
        setTapHint("Route compare failed — try again when you have a signal.");
        window.setTimeout(() => setTapHint(null), 5000);
      }
    } finally {
      setBypassBusy(false);
    }
  }, [
    isPlus,
    env.mapboxToken,
    userLngLat,
    effectiveUserLngLat,
    demoBypassTrafficJamPlus,
    destLngLat,
    guidanceRoute,
    routeImpactsForUi,
    userAlongGuidanceM,
    trafficBypassContext,
    openRouteCompareFromPlan,
    activateRouteCompare,
    stormAlertsForRouting,
    settingStormEnabled,
  ]);

  /* Hazard sheet's "Try alternate route" CTA is only meaningful when we have Plus + Mapbox +
   * an active trip. Hoisted out of the JSX IIFE in Phase 4e4 so the render path stays declarative.
   * Placed below `handleTrafficBypassFromHere` because the handler closes over it. */
  const hazardSheetAlternateAvailable = useMemo(
    () =>
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
    const name = destinationLabel.trim() || "Saved place";
    addPlace(name, destLngLat);
  }, [destLngLat, destinationLabel, addPlace]);

  const handleSaveCurrentLocation = useCallback(async () => {
    if (!userLngLat) {
      setTapHint(
        locationError ?? "Turn on location first — allow it for this site in browser settings."
      );
      window.setTimeout(() => setTapHint(null), 8000);
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
  }, [userLngLat, locationError, forecastPlaceShort, env.mapboxToken, addPlace]);

  const openSaveRouteSheet = useCallback(() => {
    const r = plan.routes.find((x) => x.id === lineFocusId) ?? plan.routes[0];
    if (!r?.geometry || r.geometry.length < 2 || !destLngLat) return;
    setPendingSave({
      kind: "route",
      geometry: r.geometry.map(([a, b]) => [a, b]),
      turnSteps: r.turnSteps,
      destinationLngLat: [...destLngLat],
      destinationLabel: destinationLabel.trim() || "Destination",
    });
  }, [plan.routes, lineFocusId, destLngLat, destinationLabel]);

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
        actionLabel: "Compare routes",
        onAction:
          isPlus && env.mapboxToken && userLngLat && destLngLat && guidanceRoute?.geometry?.length
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
        showProgressRail ? " nav-progress-rail-on" : ""
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
            routes={driveMapRoutes}
            lineFocusId={driveMapLineFocusId}
            suggestedRouteId={suggestedRouteId}
            userLngLat={effectiveUserLngLat}
            destLngLat={destLngLat}
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
            radarAnimate={!dataSaverMode}
            onRadarFrameUtcSec={setRadarFrameUtcSec}
            alongRouteAlerts={mapAlongRouteAlerts}
            corridorRouteGeometry={guidanceRoute?.geometry}
            recordingGeometry={recordingActive ? recordingPathPreview : undefined}
            weatherAlertGeoJson={nwsAlertGeoJsonForMap}
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
            activityTrailGeoJson={activityTrailGeoJsonForMap}
            activityTrailPlanningBounds={activityTrailPlanningBounds}
            idleHomeMapFraming={idleHomeMapFraming}
            homePreloadEnabled={isPlus && learnEnabled && homePreloadEnabled}
            homePreloadBounds={homePreloadBounds}
            searchPickMarkers={searchPickMarkersForMap}
            onSearchPickMarkerClick={searchPickMarkersForMap ? handleSearchPickFromMap : undefined}
            progressRailVisible={navigationStarted && isPlus}
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
                      sessionOn={advisoryPlusDetailOn}
                      onSessionToggle={onStormSessionToggle}
                      loading={
                        stormLoading &&
                        stormCorridorAlerts.length === 0 &&
                        !(stormMapGeoJson?.features?.length)
                      }
                      error={stormError}
                      corridorAlerts={stormCorridorAlerts}
                      overlappingAlerts={
                        advisoryPlusDetailOn
                          ? nwsAlertsForGuidanceAdvisory
                          : nwsAlertsForGuidanceAdvisory.filter(nwsAlertIsBasicEmergency)
                      }
                      nwsAtLocationAlerts={
                        advisoryPlusDetailOn
                          ? stormNwsPuckInside
                          : stormNwsPuckInside.filter(nwsAlertIsBasicEmergency)
                      }
                      trafficDelayMinutes={guidanceSlice?.trafficDelayMinutes ?? 0}
                      onTrafficReroute={
                        isPlus && env.mapboxToken && userLngLat && destLngLat && guidanceRoute
                          ? () => void handleTrafficBypassFromHere()
                          : undefined
                      }
                      trafficRerouteBusy={bypassBusy}
                      roadDetailEnabled={isPlus && roadAdvisoryDetailOn}
                      onRoadDetailToggle={onRoadAdvisoryDetailToggle}
                      hasGuidanceRoute={Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2)}
                      roadDetailRows={advisoryRoadDetailRows}
                      routeImpacts={advisoryRouteImpacts}
                      stormStripBands={advisoryStormStripBands}
                      routeTotalMeters={guidanceRouteLengthM}
                      userAlongMeters={advisoryUserAlongM}
                      planEtaMinutes={guidanceRoute?.baseEtaMinutes ?? null}
                      driveEtaMinutes={driveEtaMinutes ?? null}
                      barExpanded={stormBarExpanded}
                      onBarExpandedChange={onStormBarExpandedChange}
                      hideHeadToggles={!isPlus}
                      onNwsAlertClick={handleAdvisoryNwsClick}
                      busyLabel={activityBusyLabel}
                      driveRouteAheadLine={driveModeUi ? driveRouteAheadLine : null}
                      advisoryTier={advisoryPlusDetailOn ? "plus" : "basic"}
                      ownsPlus={isPlus}
                      promoLines={advisoryPromoLines}
                      isOnline={isOnline}
                      basicNavAdvisoryMode={!isPlus}
                      navigationStarted={navigationStarted}
                      nowcastLine={advisoryNowcastLine}
                      currentNowcast={currentNowcast}
                      forecastAreaLabel={forecastAreaLabel}
                      minutePrecipForecast={tioMinutePrecip}
                      hourlyForecast={localHourlyForecast}
                      localForecastNwsAlerts={localForecastNwsAlerts}
                      nwsForecastLoading={
                        stormLoading &&
                        stormCorridorAlerts.length === 0 &&
                        !(stormMapGeoJson?.features?.length)
                      }
                      nwsForecastError={stormError}
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
                  {hazardApproachAlertsActive &&
                  driveApproachBannerPick &&
                  (showTrafficBypassCta ||
                    driveApproachBannerPick.impact.id === "demo-approach-banner" ||
                    driveApproachBannerPick.impact.id === "demo-close-hazard") ? (
                    <DriveHazardApproachBanner
                      phase={driveApproachBannerPick.phase}
                      impact={driveApproachBannerPick.impact}
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
                  <div
                    className={`route-progress-callout-rail-cluster${
                      progressCalloutsOpen && progressCalloutCount > 0
                        ? " route-progress-callout-rail-cluster--open"
                        : ""
                    }`}
                  >
                    {progressCalloutsOpen && progressCalloutCount > 0 && (
                      <div
                        className="route-progress-callout-panel route-progress-callout-panel--rail route-progress-callout-panel--with-docked-toggle"
                        role="list"
                        aria-label="Progress bar segments"
                      >
                        <div className="route-progress-callout-panel__track" ref={progressCalloutTrackRef}>
                          {progressCalloutPanel.routeWide.length > 0 && (
                            <div
                              className="route-progress-callout-panel__route-wide"
                              role="group"
                              aria-label="Whole route"
                            >
                              {progressCalloutPanel.routeWide.map((it) => (
                                <div
                                  key={it.key}
                                  className="route-progress-callout-panel__line route-progress-callout-panel__line--route-wide"
                                  role="listitem"
                                  title={it.tooltip}
                                >
                                  <span
                                    className="route-progress-callout-panel__dot"
                                    style={{ backgroundColor: it.color }}
                                  />
                                  <div className="route-progress-callout-panel__line-body">
                                    <div className="route-progress-callout-panel__title-row">
                                      <span className="route-progress-callout-panel__title">{it.title}</span>
                                      <span className="route-progress-callout-panel__along">ALL</span>
                                    </div>
                                    {it.summary ? (
                                      <p className="route-progress-callout-panel__summary">{it.summary}</p>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {progressCalloutPanel.segments.length > 0 && (
                              <>
                                <hr
                                  className="route-progress-callout-panel__divider"
                                  aria-hidden
                                />
                                <p className="route-progress-callout-panel__timeline-label" aria-hidden>
                                  Along route
                                </p>
                              </>
                            )}
                          {progressCalloutPanel.segments.map((it) => (
                            <div
                              key={it.key}
                              className="route-progress-callout-panel__line"
                              role="listitem"
                              title={it.tooltip}
                            >
                              <span
                                className="route-progress-callout-panel__dot"
                                style={{ backgroundColor: it.color }}
                              />
                              <div className="route-progress-callout-panel__line-body">
                                <div className="route-progress-callout-panel__title-row">
                                  <span className="route-progress-callout-panel__title">{it.title}</span>
                                  <span className="route-progress-callout-panel__along">{it.alongPct}%</span>
                                </div>
                                {it.summary ? (
                                  <p className="route-progress-callout-panel__summary">{it.summary}</p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                          {progressCalloutPanel.outlookTimeline.length > 0 && (
                            <>
                              {progressCalloutPanel.segments.length > 0 && (
                                <hr
                                  className="route-progress-callout-panel__divider route-progress-callout-panel__divider--above-outlook"
                                  aria-hidden
                                />
                              )}
                              <RouteOutlookTimeline
                                steps={progressCalloutPanel.outlookTimeline}
                                userAlongT={progressCalloutPanel.userAlongT}
                                stripTint={progressCalloutPanel.stripTint}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      className={`route-progress-callout-toggle${
                        progressCalloutsOpen ? " route-progress-callout-toggle--on" : ""
                      }${
                        progressCalloutsOpen && progressCalloutCount > 0
                          ? " route-progress-callout-toggle--docked"
                          : ""
                      }`}
                      aria-pressed={progressCalloutsOpen}
                      title={
                        progressCalloutsOpen
                          ? "Hide strip labels"
                          : "Show labels for colored segments on the progress bar"
                      }
                      onClick={() => setProgressCalloutsOpen((o) => !o)}
                    >
                      ⧉
                    </button>
                  </div>
                  <RouteProgressStrip
                    layout="side"
                    geometry={progressRailRoute.geometry}
                    userLngLat={effectiveUserLngLat}
                    userAlongMeters={userAlongGuidanceM}
                    alerts={progressStripAlerts}
                    radarIntensity={guidanceSlice?.radarIntensity ?? 0}
                    routeLineColor={progressStripRouteColor}
                    turnSteps={progressRailRoute.turnSteps ?? turnSteps}
                    stormBands={stormProgressBands}
                    onCorridorBandClick={isPlus ? handleProgressStripCorridorClick : undefined}
                    onStormBandClick={isPlus ? handleProgressStripStormClick : undefined}
                    driveEndsEmphasis={driveModeUi}
                    tripOdometerM={tripOdometerM}
                    tripRelativeProgress={navigationStarted}
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

        <SavedDestinationsDrawer
          open={savedDrawerOpen}
          onClose={() => setSavedDrawerOpen(false)}
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
            Add <code>VITE_MAPBOX_TOKEN</code> in <code>web/.env</code>.
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
                          activeSlotIndex={viewMode === "route" ? previewLegIndex : null}
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
                        onClick={() => setRecenterPlanningPuckTick((n) => n + 1)}
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
                            placeholder="Search address or place"
                            suggestions={suggestions}
                            onPickSuggestion={(h) => void handlePickSuggestion(h)}
                            suggestionsLoading={suggestLoading}
                            showSuggestionsWhenEmpty={isNarrowPhoneViewport()}
                            enableSuggestions={allowAutocomplete && (!routeActive || searchExpanded)}
                          />
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
              onViewMode={setViewMode}
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
              offRouteSevere={offRouteSevere}
              showOffRouteBanner={showOffRouteManualBanner}
              onRerouteFromHere={() => void recalcRouteFromHere()}
              showTrafficBypass={showTrafficBypassCta}
              bypassBusy={bypassBusy}
              onTrafficBypass={() => void handleTrafficBypassFromHere()}
            />
          </div>
          ) : null}
        </div>
      </div>

      <AboutSheet
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        payTierProbeKey={payTierProbeKey}
        onPayTierOverride={env.payTierTestPanel ? reprobePayTier : undefined}
        activityTrail={activityTrailAboutPanel}
        settings={{
          radarEnabled: settingRadarEnabled,
          stormEnabled: settingStormEnabled,
          trafficEnabled: settingTrafficEnabled,
          weatherHintsEnabled: settingWeatherHintsEnabled,
          dataSaverEnabled: settingDataSaverEnabled,
          autoRerouteEnabled: settingAutoRerouteEnabled,
          voiceGuidanceEnabled: settingVoiceGuidanceEnabled,
          gpsHighRefreshEnabled: settingGpsHighRefreshEnabled,
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
      />

      <Coachmarks replayKey={coachmarksReplayKey} />
    </div>
  );
}
