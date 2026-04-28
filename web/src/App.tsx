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
import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { getWebEnv } from "./config/env";
import { useFusedSituation } from "./hooks/useFusedSituation";
import { useSavedPlaces } from "./hooks/useSavedPlaces";
import { useSavedRoutes } from "./hooks/useSavedRoutes";
import { useRouteRecorder } from "./hooks/useRouteRecorder";
import { useTurnVoiceGuidance } from "./hooks/useTurnVoiceGuidance";
import { useSessionOdometerMeters } from "./hooks/useSessionOdometerMeters";
import { useUserLocation } from "./hooks/useUserLocation";
import { useRadarBandsAlongRoute } from "./hooks/useRadarBandsAlongRoute";
import { buildMockTripBetween, EMPTY_TRIP } from "./nav/emptyTrip";
import { mergePlanPreservingPrimary } from "./nav/mergePlanRoutes";
import { tripPlanFromSavedRoute } from "./nav/planFromSavedRoute";
import type { SavedRoute } from "./nav/savedRoutes";
import type { LngLat, RouteTurnStep, TripPlan } from "./nav/types";
import { pickSuggestedActive, scoreTrip } from "./scoring/scoreRoutes";
import { buildTripFromMapbox, collectMapboxRouteVariants } from "./services/mapboxDirectionsRouter";
import { isAbortError, isSaveDataPreferred, routeFetchUserMessage } from "./utils/fetchResilient";
import {
  mapboxAutocomplete,
  mapboxGeocodeSearch,
  mapboxReverseGeocode,
} from "./services/mapboxGeocode";
import { fetchMapboxTrafficAlongPolyline } from "./services/mapboxDirectionsTraffic";
import {
  fetchMapboxDrivingTrafficRoute,
  fetchMapboxSurgicalBypass,
  fetchMapboxTrafficAlternatives,
} from "./services/mapboxRouteAlternatives";
import {
  weatherForecastAlongRoute,
  weatherHintSamplesAlongPolyline,
} from "./services/openWeatherClient";
import type { RouteAlert } from "./nav/routeAlerts";
import { augmentAlertsForProgressStrip, buildRouteAlerts } from "./nav/routeAlerts";
import { buildSimpleCalloutBlock } from "./nav/progressCalloutCopy";
import { buildRouteChunkCalloutList } from "./nav/routeProgressChunkList";
import { layoutStripAlerts } from "./nav/stripAlertLayout";
import {
  bearingAlongRouteAhead,
  closestAlongRouteMeters,
  haversineMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
  slicePolylineBetweenAlong,
} from "./nav/routeGeometry";
import { bannerPrimaryStepIndex } from "./nav/bannerPrimaryStep";
import { useAlongRouteMetersHeldWhenOffLine } from "./nav/guidanceAlongHold";
import { activeTurnStepIndexAlong, turnStepAlongBounds } from "./nav/turnStepAlong";
import { formatRouteDistanceMi, routeConsiderationSummary } from "./nav/routeSummary";
import { pickDriveAheadCandidate } from "./nav/driveAheadPick";
import { buildDriveRouteAheadLine } from "./nav/driveRouteAhead";
import { computeTrafficBypassOffer } from "./nav/trafficBypassOffer";
import { unifiedTrafficNarrative } from "./nav/trafficNarrative";
import {
  ARRIVAL_BG_CLEAR_MIN_MS,
  ARRIVAL_DEST_RADIUS_M,
  ARRIVAL_IDLE_CLEAR_MS,
  ARRIVAL_STATIONARY_MAX_SPEED_MPS,
} from "./nav/constants";
import type { TrafficOverlay, WeatherOverlay } from "./situation/fusedSnapshot";
import type { MapFocusRequest, MapViewMode } from "./ui/driveMapTypes";
import { STORMPATH_CLIENT_BUILD } from "./buildStamp";

const DriveMap = lazy(() => import("./ui/DriveMap"));
import { SearchBar } from "./ui/SearchBar";
import type { SearchSuggestion } from "./ui/SearchBar";
import { BottomToolbar } from "./ui/BottomToolbar";
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
import { RouteProgressStrip } from "./ui/RouteProgressStrip";
import { estimatePostedSpeedMph } from "./ui/DriveHud";
import { formatEtaDuration } from "./ui/formatEta";
import { StormAdvisoryBar } from "./ui/StormAdvisoryBar";
import { ActivityStatusPill } from "./ui/ActivityStatusPill";
import { AboutSheet } from "./ui/AboutSheet";
import { TrafficBypassComparePanel } from "./ui/TrafficBypassComparePanel";
import type { TrafficBypassCompareCallout } from "./ui/DriveMap";
import { pointAlongPolyline } from "./ui/geometryAlong";
import { NWS_REQUEST_USER_AGENT } from "./config/nwsUserAgent";
import {
  fetchNwsAlertsForBrowseViewport,
  fetchNwsAlertsForRouteCorridor,
  nwsBrowseBoundsAroundLngLat,
} from "./weatherAlerts/nwsUsProvider";
import {
  computeRouteOverlapWithAlerts,
  pointInAnyPolygonGeometry,
  stormAlongBandsForProgressStrip,
} from "./weatherAlerts/geometryOverlap";
import { normalizedWeatherToRouteAlert, routeAlertsFromStormBandMidpoint } from "./weatherAlerts/nwsAsRouteAlerts";
import type { NormalizedWeatherAlert } from "./weatherAlerts/types";
import {
  filterMapGeoJsonToBasicEmergencies,
  nwsAlertIsBasicEmergency,
} from "./weatherAlerts/basicEmergencyFilter";
import { buildAdvisoryPromoLines, buildBasicNavAdvisoryPromoLines } from "./config/advisoryPromo";
import { getPayTier } from "./billing/payFeatures";
import type { FrequentRouteCluster } from "./frequentRoutes/types";
import { learnedClusterToSavedRoute } from "./frequentRoutes/learnedToSaved";
import { useFrequentRouteLearning } from "./hooks/useFrequentRouteLearning";
import { isMapBasemapDaytime } from "./map/mapBasemapDaytime";
import {
  ACTIVITY_SAMPLES_UPDATED_EVENT,
  activitySamplesToGeoJson,
  clearActivitySamples,
  getActivityTrailStats,
  loadActivitySamples,
} from "./frequentRoutes/activitySamples";
import { BYPASS_HEAVY_DELAY_MINUTES } from "./nav/constants";
import { clearActiveTripCache, saveActiveTripToCache } from "./tripCache";
import { loadRecentSearchSuggestions, recordRecentSearch } from "./recentSearches";
import {
  areaKeyFromLngLat,
  areaLabelFromDestinationLabel,
  loadPreferredAreaRouteMap,
  savePreferredAreaRouteMap,
  type PreferredAreaRouteMap,
} from "./preferredAreaRoutes";
import "./App.css";

type PendingSave =
  | null
  | {
      kind: "route";
      geometry: LngLat[];
      turnSteps?: RouteTurnStep[];
      destinationLngLat: LngLat;
      destinationLabel: string;
    }
  | {
      kind: "recorded";
      geometry: LngLat[];
      destinationLngLat: LngLat;
    }
  | { kind: "learned"; cluster: FrequentRouteCluster };

type TrafficBypassCompareState = {
  headline: string;
  etaA: number;
  etaB: number | null;
  etaC: number | null;
  hasB: boolean;
  hasC: boolean;
};

const MB_TRAFFIC_LINE_SNAP_NOTICE = "Mapbox traffic-aware line";
/** Route mode: refresh B/C alternates only (primary leg unchanged). */
const NAV_ROUTE_ALT_REFRESH_MS = 26_000;
/** Throttle between auto-reroute attempts when still far off the polyline (keep low for quick recovery). */
const NAV_SEVERE_OFF_ROUTE_THROTTLE_MS = 1_200;
/** Snap drawn line to Mapbox’s road network when live delay vs ORS is huge or Mapbox can’t trace the ORS path. */
const MAPBOX_LINE_SNAP_DELAY_MIN = 10;
/** Applies to both “heavy delay” and untraceable polyline — avoids GPS-driven snap loops in drive/topdown. */
const MAPBOX_LINE_SNAP_COOLDOWN_MS = 45_000;
/** Best-effort cap for IndexedDB writes while still capturing route refreshes. */
const TRIP_CACHE_MIN_SAVE_INTERVAL_MS = 20_000;

/** v2: first visit — radar overlay + road/traffic strip off. */
const LAYER_DEFAULTS_MIGRATION_KEY = "stormpath-layer-defaults-v2";
/** v3: v2 skipped after first run, but some profiles still had `stormpath-radar-overlay-on` stuck at "1" — force off once. */
const RADAR_OVERLAY_DEFAULT_V3_KEY = "stormpath-radar-overlay-default-v3";

function applyStormLayerStorageMigrations(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(LAYER_DEFAULTS_MIGRATION_KEY) !== "1") {
      localStorage.setItem("stormpath-radar-overlay-on", "0");
      localStorage.setItem("stormpath-road-advisory-detail", "0");
      localStorage.setItem(LAYER_DEFAULTS_MIGRATION_KEY, "1");
    }
    if (localStorage.getItem(RADAR_OVERLAY_DEFAULT_V3_KEY) !== "1") {
      localStorage.setItem("stormpath-radar-overlay-on", "0");
      localStorage.setItem(RADAR_OVERLAY_DEFAULT_V3_KEY, "1");
    }
  } catch {
    /* ignore */
  }
}

function isNarrowPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches;
}

export default function App() {
  applyStormLayerStorageMigrations();
  const env = useMemo(() => getWebEnv(), []);
  const demoBypassTrafficJam = useMemo(() => {
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
  /** Plus vs Basic from `getPayTier()` (build env + optional LS override) — identical in dev and production. */
  const isPlus = useMemo(() => getPayTier() === "plus", [payTierProbeKey]);
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
  const [settingGpsHighRefreshEnabled, setSettingGpsHighRefreshEnabled] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-gps-high-refresh");
      if (v === "1" || v === "true") return true;
      if (v === "0" || v === "false") return false;
    } catch {
      /* ignore */
    }
    return false;
  });
  /** Landscape / side view only — CSS mirrors chrome when "left"; portrait ignores */
  const [settingLandscapeSideHand, setSettingLandscapeSideHand] = useState<"right" | "left">(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-landscape-side-hand");
      if (v === "left") return "left";
    } catch {
      /* ignore */
    }
    return "right";
  });
  const { lngLat: userLngLat, heading, speedMps, error: locationError } = useUserLocation(true, {
    highRefresh: settingGpsHighRefreshEnabled,
  });
  const userLngLatRef = useRef(userLngLat);
  userLngLatRef.current = userLngLat;
  const speedMpsRef = useRef(speedMps);
  speedMpsRef.current = speedMps;

  const {
    suggestedClusters,
    learnEnabled,
    setLearnEnabled,
    dismissCluster,
  } = useFrequentRouteLearning({
    payUnlocked: payFrequentRoutes,
    userLngLat,
    speedMps,
  });

  const ACTIVITY_TRAIL_MAP_LS = "stormpath-activity-trail-map-on";
  const [activityTrailMapOn, setActivityTrailMapOn] = useState(() => {
    try {
      return localStorage.getItem(ACTIVITY_TRAIL_MAP_LS) === "1";
    } catch {
      return false;
    }
  });
  const [activityTrailTick, setActivityTrailTick] = useState(0);
  useEffect(() => {
    const on = () => setActivityTrailTick((n) => n + 1);
    window.addEventListener(ACTIVITY_SAMPLES_UPDATED_EVENT, on);
    return () => window.removeEventListener(ACTIVITY_SAMPLES_UPDATED_EVENT, on);
  }, []);

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
  const [pendingSave, setPendingSave] = useState<PendingSave>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const [recordedSuggestName, setRecordedSuggestName] = useState("");
  const [recordedEndLabel, setRecordedEndLabel] = useState("Recorded destination");
  const [recordedStartLabel, setRecordedStartLabel] = useState("Start of path");

  const [stormSessionOn, setStormSessionOn] = useState(() => {
    try {
      const v = localStorage.getItem("storm-advisory-session");
      if (v === "off") return false;
    } catch {
      /* ignore */
    }
    return true;
  });

  /** Never persisted — each route session starts closed; cleared when the plan changes or the trip is stopped. */
  const [progressCalloutsOpen, setProgressCalloutsOpen] = useState(false);
  const progressCalloutTrackRef = useRef<HTMLDivElement | null>(null);
  const progressCalloutWasOpenRef = useRef(false);

  /** Road & traffic overlay: default off when unset (turn on from strip or Hazard panel). */
  const [roadAdvisoryDetailOn, setRoadAdvisoryDetailOn] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-road-advisory-detail");
      if (v === "0") return false;
      if (v === "1") return true;
    } catch {
      /* ignore */
    }
    return false;
  });

  // Settings (persisted): toggles that actually reduce background API calls.
  const [settingStormEnabled, setSettingStormEnabled] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-storm-enabled");
      if (v === "0" || v === "false") return false;
      if (v === "1" || v === "true") return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [settingTrafficEnabled, setSettingTrafficEnabled] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-traffic-enabled");
      if (v === "0" || v === "false") return false;
      if (v === "1" || v === "true") return true;
    } catch {
      /* ignore */
    }
    return false;
  });
  const [settingWeatherHintsEnabled, setSettingWeatherHintsEnabled] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-weather-hints-enabled");
      if (v === "0" || v === "false") return false;
      if (v === "1" || v === "true") return true;
    } catch {
      /* ignore */
    }
    return false;
  });
  const [settingAutoRerouteEnabled, setSettingAutoRerouteEnabled] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-auto-reroute-enabled");
      if (v === "0" || v === "false") return false;
      if (v === "1" || v === "true") return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [settingRadarEnabled, setSettingRadarEnabled] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-radar-enabled");
      if (v === "0" || v === "false") return false;
      if (v === "1" || v === "true") return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [settingVoiceGuidanceEnabled, setSettingVoiceGuidanceEnabled] = useState(() => {
    try {
      const v = localStorage.getItem("stormpath-setting-voice-guided");
      if (v === "1" || v === "true") return true;
      if (v === "0" || v === "false") return false;
    } catch {
      /* ignore */
    }
    return false;
  });
  const [stormCorridorAlerts, setStormCorridorAlerts] = useState<NormalizedWeatherAlert[]>([]);
  const [stormOverlapping, setStormOverlapping] = useState<NormalizedWeatherAlert[]>([]);
  const [stormMapGeoJson, setStormMapGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  /** True once we have polygons to draw; avoids flashing "Loading NWS" on 120s refresh while keeping prior map data. */
  const stormMapHasDisplayableRef = useRef(false);
  const [stormLoading, setStormLoading] = useState(false);
  const [stormError, setStormError] = useState<string | null>(null);
  const [stormBarExpanded, setStormBarExpanded] = useState(() => {
    try {
      if (typeof localStorage === "undefined") return true;
      const v = localStorage.getItem("stormpath-storm-advisory-bar-expanded");
      if (v === "0") return false;
      if (v === "1") return true;
      const legacy = localStorage.getItem("stormpath-storm-drawer-expanded");
      if (legacy === "0") return false;
      if (legacy === "1") return true;
      return isNarrowPhoneViewport() ? false : true;
    } catch {
      return isNarrowPhoneViewport() ? false : true;
    }
  });
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
  const [plan, setPlan] = useState<TripPlan>(EMPTY_TRIP);
  const [destLngLat, setDestLngLat] = useState<[number, number] | null>(null);
  const [destinationLabel, setDestinationLabel] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(true);
  const [searchEditing, setSearchEditing] = useState(false);
  const [allowAutocomplete, setAllowAutocomplete] = useState(true);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  /** Invalidates in-flight autocomplete when the query changes so stale results do not flash in. */
  const searchAutocompleteSeqRef = useRef(0);
  /** Lets suggestion taps win over blur before parent clears the list. */
  const searchBlurClearTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  /** Bumped on Stop/clear — in-flight route fetches must not call setPlan after the user cleared the trip. */
  const routeGraphEpochRef = useRef(0);
  /** Cancels the active primary Directions request when the user starts a new route, reroutes, or clears. */
  const routeMainFetchAbortRef = useRef<AbortController | null>(null);
  /** B/C refresh while driving — separate from {@link routeMainFetchAbortRef} so it does not cancel a new trip build. */
  const altRoutesFetchAbortRef = useRef<AbortController | null>(null);
  /** Invalidates in-flight NWS fetches when storm deps change so stale responses cannot repopulate the map. */
  const nwsFetchGenRef = useRef(0);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const [tapHint, setTapHint] = useState<string | null>(null);
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
  const [navigationStarted, setNavigationStarted] = useState(false);
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
  const [viewMode, setViewMode] = useState<MapViewMode>("route");

  const driveModeUi = navigationStarted && viewMode === "drive";
  /** NWS polygons + fetches follow the user’s NWS toggle everywhere (including drive — no auto-on). */
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);
  const [bypassBusy, setBypassBusy] = useState(false);
  const [trafficBypassCompare, setTrafficBypassCompare] = useState<TrafficBypassCompareState | null>(null);
  const [demoPlaybackAlongM, setDemoPlaybackAlongM] = useState<number | null>(null);
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
  const [mapFocus, setMapFocus] = useState<MapFocusRequest | null>(null);
  /** Map bearing in drive mode — compass above the info button. */
  const [driveMapBearingDeg, setDriveMapBearingDeg] = useState<number | null>(null);
  const [routeHazardSheet, setRouteHazardSheet] = useState<{
    routeId: string;
    alerts: RouteAlert[];
  } | null>(null);
  /** Map overlay (toolbar Rad). Only `stormpath-radar-overlay-on` — default off; Settings controls whether Rad is enabled. */
  const [showRadar, setShowRadar] = useState(() => {
    try {
      const o = localStorage.getItem("stormpath-radar-overlay-on");
      if (o === "0" || o === "false") return false;
      if (o === "1" || o === "true") return true;
    } catch {
      /* ignore */
    }
    return false;
  });
  useEffect(() => {
    try {
      localStorage.setItem("stormpath-radar-overlay-on", showRadar ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showRadar]);
  /** Rad toolbar + map overlay: planning with no route, or after Go — not while A/B/C preview before navigation. */
  const offerRadarChrome = plan.routes.length === 0 || navigationStarted;
  const radarMapOverlayOn = showRadar && !driveModeUi && offerRadarChrome;
  useEffect(() => {
    if (plan.routes.length > 0 && !navigationStarted) {
      setShowRadar(false);
    }
  }, [plan.routes.length, navigationStarted]);
  const [radarFrameUtcSec, setRadarFrameUtcSec] = useState<number | null>(null);
  const seriousHazardAutoFlewRef = useRef<Set<string>>(new Set());
  const [safetyAck, setSafetyAck] = useState(() => {
    try {
      return localStorage.getItem("stormpath-safety-ack-v1") === "1";
    } catch {
      return false;
    }
  });
  /** Display order: [0]=Route A blue, [1]=B, [2]=C — permutes when you promote a leg (Go / hazard / bypass). */
  const [routeSlotOrder, setRouteSlotOrder] = useState<string[]>([]);
  /** Which A/B/C slot is highlighted in route view (0..n-1). Separate from slot 0 so the cycle can reach all legs. */
  const [previewLegIndex, setPreviewLegIndex] = useState(0);

  /** Matches Mapbox dark-v11 window — stronger chrome borders when the basemap is night. */
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
    console.info(
      `[stormpath boot] ${STORMPATH_CLIENT_BUILD}`,
      "tier:", tierLabel,
      "| mapboxToken:", env.mapboxToken ? "YES" : "NO",
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

  const computeRoutes = useCallback(
    async (
      end: [number, number],
      label: string,
      opts?: { preserveNavigation?: boolean }
    ) => {
      if (!userLngLat) return;
      const epochAtStart = routeGraphEpochRef.current;
      routeMainFetchAbortRef.current?.abort();
      const mainFetch = new AbortController();
      routeMainFetchAbortRef.current = mainFetch;
      setRouting(true);
      setRouteError(null);
      setTapHint(null);
      if (!opts?.preserveNavigation) {
        resetNavigationPlanning();
        /* Route planning mode is the immediate next UI step; don't wait on router/post-processing. */
        setViewMode("route");
        setSearchExpanded(false);
      }
      try {
        let p: TripPlan;
        let destForMap: [number, number] = end;
        if (env.mapboxToken) {
          const built = await buildTripFromMapbox(
            env.mapboxToken,
            userLngLat,
            end,
            {
              origin: "Your location",
              destination: label,
            },
            {
              signal: mainFetch.signal,
              allowLocalTripThirdRoute: isPlus,
              preferThreeRoutes: isPlus,
            }
          );
          p = built.plan;
          destForMap = built.routeDestination;
          if (built.snapNotice) {
            setTapHint(built.snapNotice);
            window.setTimeout(() => setTapHint(null), 8500);
          }
        } else {
          p = buildMockTripBetween(userLngLat, end, label);
        }
        p = !isPlus && p.routes.length > 2 ? { ...p, routes: p.routes.slice(0, 2) } : p;
        if (epochAtStart !== routeGraphEpochRef.current) return;
        setPlan(p);
        if (payFrequentRoutes) {
          // Apply learned “preferred route” for this destination area (city-ish bucket).
          const prefKey = areaKeyFromLngLat(destForMap);
          const pref = preferredAreaRouteMapRef.current[prefKey];
          const preferredRole = pref?.preferredRole;
          if (preferredRole && p.routes.some((r) => r.role === preferredRole)) {
            const preferredId = p.routes.find((r) => r.role === preferredRole)!.id;
            const ids = slotOrderAfterSelect(p.routes.map((r) => r.id), preferredId);
            setRouteSlotOrder(ids);
            setPreviewLegIndex(0);
          } else {
            setRouteSlotOrder(p.routes.map((r) => r.id));
            setPreviewLegIndex(0);
          }
        } else {
          setRouteSlotOrder(p.routes.map((r) => r.id));
          setPreviewLegIndex(0);
        }
        setDestLngLat(destForMap);
        setViewMode("route");
        setFitTrigger((n) => n + 1);
        setSearchExpanded(false);
      } catch (e) {
        if (isAbortError(e)) return;
        setRouteError(
          routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e))
        );
      } finally {
        setRouting(false);
      }
    },
    [userLngLat, env.mapboxToken, resetNavigationPlanning, payFrequentRoutes, isPlus]
  );

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
    [userLngLat, destLngLat, env.mapboxToken, destinationLabel, computeRoutes, isOnline, resetNavigationPlanning, isPlus]
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
      setSearchPickHits(null);
      searchPickQueryRef.current = null;
      recordRecentSearch(hit.placeName, hit.lngLat);
      setAllowAutocomplete(true);
      setSuggestions([]);
      setSearchText(hit.placeName);
      setDestinationLabel(hit.placeName);
      setDestLngLat(hit.lngLat);
      setViewMode("route");
      setSearchExpanded(false);
      await computeRoutes(hit.lngLat, hit.placeName);
    },
    [userLngLat, computeRoutes, locationError, recordRecentSearch]
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
      setSuggestions(loadRecentSearchSuggestions());
    }
    setSuggestLoading(false);
    setAllowAutocomplete(true);
  }, [searchText]);

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
      setSuggestions(loadRecentSearchSuggestions());
    } else {
      setSuggestions([]);
    }
    setSuggestLoading(false);
    setAllowAutocomplete(true);
  }, []);

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
        setSuggestions(loadRecentSearchSuggestions());
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
      void mapboxAutocomplete(q, env.mapboxToken, limit, prox).then((hits) => {
        if (seq !== searchAutocompleteSeqRef.current) return;
        setSuggestions(hits.slice(0, limit));
        setSuggestLoading(false);
      });
    }, 280);
    return () => window.clearTimeout(t);
    /* userLngLat omitted: GPS updates ~400ms would cancel this debounce and flash the list every tick. */
  }, [searchText, env.mapboxToken, allowAutocomplete, searchExpanded, plan.routes.length, searchEditing]);

  const planRef = useRef(plan);
  planRef.current = plan;
  const planRoutesKeyStable = useMemo(() => plan.routes.map((r) => r.id).join("|"), [plan.routes]);

  useEffect(() => {
    const routes = planRef.current.routes;
    if (routing) return;
    if (!navigationStarted) {
      setWeatherOverlay(undefined);
      return;
    }
    if (!isPlus || !isOnline || !settingWeatherHintsEnabled || !env.openWeatherApiKey || !routes.length) {
      setWeatherOverlay(undefined);
      return;
    }
    let cancelled = false;
    const LONG_ROUTE_M = 1_000_000;
    const LONG_ETA_MIN = 720;
    const saveData = isSaveDataPreferred();
    (async () => {
      const w: WeatherOverlay = {};
      await Promise.all(
        routes.map(async (r) => {
          if (cancelled) return;
          try {
            const eta = r.baseEtaMinutes ?? 30;
            const lenM = polylineLengthMeters(r.geometry);
            if (saveData || lenM > LONG_ROUTE_M || eta > LONG_ETA_MIN) {
              const hint = await weatherHintSamplesAlongPolyline(env.openWeatherApiKey, r.geometry);
              if (!cancelled) w[r.id] = hint;
            } else {
              const [hint, fc] = await Promise.all([
                weatherHintSamplesAlongPolyline(env.openWeatherApiKey, r.geometry),
                weatherForecastAlongRoute(env.openWeatherApiKey, r.geometry, eta),
              ]);
              if (!cancelled) {
                w[r.id] = {
                  headline: fc.headline || hint.headline,
                  precipHint: Math.max(fc.precipHint ?? 0, hint.precipHint ?? 0),
                  samples: hint.samples,
                };
              }
            }
          } catch {
            try {
              const hint = await weatherHintSamplesAlongPolyline(env.openWeatherApiKey, r.geometry);
              if (!cancelled) w[r.id] = hint;
            } catch {
              /* skip */
            }
          }
        })
      );
      if (!cancelled) setWeatherOverlay(Object.keys(w).length ? w : undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    planRoutesKeyStable,
    env.openWeatherApiKey,
    settingWeatherHintsEnabled,
    isOnline,
    routing,
    navigationStarted,
    isPlus,
  ]);

  const trafficRefreshRef = useRef(0);
  const [trafficRefreshKey, setTrafficRefreshKey] = useState(0);

  useEffect(() => {
    const routes = planRef.current.routes;
    if (routing) {
      setTrafficFetchDone(true);
      return;
    }
    if (!navigationStarted) {
      setTrafficOverlay(undefined);
      setTrafficFetchDone(true);
      return;
    }
    if (!isPlus || !isOnline || !settingTrafficEnabled || !env.mapboxToken || !routes.length) {
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
      setTrafficOverlay(undefined);
      setTrafficFetchDone(true);
      return;
    }
    let cancelled = false;
    setTrafficFetchDone(false);
    console.info("[traffic v2] fetching for", routes.length, "route(s)…");
    (async () => {
      const next: TrafficOverlay = {};
      await Promise.all(
        routes.map(async (r) => {
          if (cancelled) return;
          try {
            const leg = await fetchMapboxTrafficAlongPolyline(env.mapboxToken, r.geometry);
            console.info(
              "[traffic v2] route",
              r.id,
              "→",
              leg
                ? `live ${leg.mapboxDurationMinutes.toFixed(1)} min, typical ${leg.typicalDurationMinutes.toFixed(1)}, delay ${leg.delayVsTypicalMinutes.toFixed(1)}, congestion: ${leg.congestionSummary}`
                : "null (API returned no data)"
            );
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
        console.info("[traffic v2] overlay set, routes with live data:", live);
        if (live === 0) {
          console.warn("[traffic v2] WARNING: all routes returned null — check Mapbox token and API access");
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
    routing,
    navigationStarted,
    isPlus,
  ]);

  useEffect(() => {
    if (!planRoutesKeyStable || !settingTrafficEnabled || !navigationStarted || !isPlus) return;
    const id = window.setInterval(() => {
      trafficRefreshRef.current += 1;
      setTrafficRefreshKey(trafficRefreshRef.current);
    }, 90_000);
    return () => window.clearInterval(id);
  }, [planRoutesKeyStable, settingTrafficEnabled, navigationStarted, isPlus]);

  const snap = useFusedSituation(plan, weatherOverlay, trafficOverlay);
  const scored = useMemo(() => scoreTrip(plan, snap, "balanced"), [plan, snap]);

  const primaryRouteId = plan.routes[0]?.id ?? "";
  const planRoutesKey = useMemo(() => plan.routes.map((r) => r.id).join("|"), [plan.routes]);
  const planRouteIds = useMemo(() => plan.routes.map((r) => r.id), [plan.routes]);
  const routeSlotOrderKey = useMemo(() => routeSlotOrder.join("|"), [routeSlotOrder]);

  const lastTripCacheSaveMsRef = useRef(0);

  useEffect(() => {
    const ids = plan.routes.map((r) => r.id);
    setRouteSlotOrder(ids);
    setPreviewLegIndex(0);
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
    setFitTrigger((n) => n + 1);
  }, [routing, navigationStarted, plan.routes.length, viewMode]);

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

  const nwsNavCorridorGeomRef = useRef<LngLat[] | undefined>(undefined);
  nwsNavCorridorGeomRef.current = nwsNavCorridorGeom;

  /** Route view while navigating: refresh B/C from current GPS; keep primary (slot A) geometry unchanged. */
  const refreshAlternateRoutesOnly = useCallback(async () => {
    if (!navigationStarted || viewMode !== "route") return;
    if (!userLngLat || !destLngLat) return;
    if (env.mapboxToken && !isOnline) return;
    const primaryId = orderedRouteIds[0];
    if (!primaryId || plan.routes.length < 2) return;
    const epochAtStart = routeGraphEpochRef.current;
    altRoutesFetchAbortRef.current?.abort();
    const altFetch = new AbortController();
    altRoutesFetchAbortRef.current = altFetch;
    setRouting(true);
    try {
      if (env.mapboxToken) {
        const fresh = await collectMapboxRouteVariants(env.mapboxToken, userLngLat, destLngLat, {
          signal: altFetch.signal,
          allowLocalTripThirdRoute: isPlus,
          preferThreeRoutes: isPlus,
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
      setRouting(false);
    }
  }, [
    navigationStarted,
    viewMode,
    userLngLat,
    destLngLat,
    orderedRouteIds,
    plan.routes.length,
    env.mapboxToken,
    destinationLabel,
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
        return {
          id: route.id,
          letter: String.fromCharCode(65 + Math.min(slot, 25)),
          etaMinutes: eta,
          suggested: routeId === suggestedRouteId,
          softPath: route.role === "hazardSmart",
          color: routePickSlotHex(slot),
        };
      })
      .filter((x): x is RoutePickItem => x != null);
  }, [scored, suggestedRouteId, orderedRouteIds, plan.routes]);

  const routeDockDetail = useMemo(() => {
    const r = plan.routes.find((x) => x.id === lineFocusId) ?? plan.routes[0];
    if (!r?.geometry?.length) return undefined;
    const dist = formatRouteDistanceMi(r.geometry);
    const blurb = routeConsiderationSummary(r);
    return `${dist} · ${blurb}`;
  }, [plan.routes, lineFocusId]);

  const guidanceRouteId = lineFocusId || primaryRouteId;
  const guidanceRoute = plan.routes.find((r) => r.id === guidanceRouteId);
  const turnSteps = guidanceRoute?.turnSteps ?? [];
  const guidanceSlice = snap.routes.find((r) => r.routeId === guidanceRouteId);

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
      if (!settingTrafficEnabled) {
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

        if (guidanceSlice.mapboxDurationMinutes != null) {
          const eta = guidanceSlice.mapboxDurationMinutes;
          rows.push({
            label: "ETA",
            text: (
              <>
                <strong>~{formatEtaDuration(eta)}</strong>{" "}
                <span className="storm-advisory-bar__road-muted">w/ traffic</span>
              </>
            ),
          });
        }
      } else {
        rows.push({
          label: "Traffic",
          text: (
            <>
              <strong>API error</strong>{" "}
              <span className="storm-advisory-bar__road-muted">
                — Mapbox couldn’t trace this path (token scope, or ORS line doesn’t match drivable roads).
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

  const userAlongGuidanceM = useAlongRouteMetersHeldWhenOffLine(
    effectiveUserLngLat,
    guidanceRoute?.geometry
  );

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
    navigating: navigationStarted && viewMode === "drive",
    activeTurnIndex: bannerTurnIndex,
    instruction: bannerTurnInstruction,
    metersToManeuverEnd: metersToBannerManeuver,
    routeLegId: guidanceRouteId,
  });

  const speedMph = speedMps != null ? speedMps * 2.23694 : null;

  /** Drive camera: align with polyline ahead (not device heading — often missing / wrong in-car). */
  const driveRouteBearingDeg = useMemo(() => {
    if (!driveModeUi || !effectiveUserLngLat || !guidanceRoute?.geometry || guidanceRoute.geometry.length < 2) {
      return null;
    }
    const b = bearingAlongRouteAhead(effectiveUserLngLat, guidanceRoute.geometry);
    // Guard: after reroute / U-turn, the closest-point projection can pick a segment behind you,
    // flipping the camera ~180°. If device heading is available, prefer it when bearings disagree strongly.
    if (b != null && heading != null && speedMps != null && speedMps > 4.5) {
      const norm = (d: number) => ((d % 360) + 360) % 360;
      const a = norm(b);
      const h = norm(heading);
      const diff = Math.abs(((a - h + 540) % 360) - 180); // 0..180
      if (diff > 70) return null; // fall back to device heading in DriveMap
    }
    return b;
  }, [driveModeUi, effectiveUserLngLat, guidanceRoute?.geometry, guidanceRoute?.id, heading, speedMps]);

  /** Full-route ETA from scoring; scale by remaining distance while navigating so it tracks progress. */
  const driveEtaMinutes = useMemo(() => {
    if (!navigationStarted) return null;
    const s = scored.find((x) => x.route.id === lineFocusId);
    const full = s
      ? Math.round(s.effectiveEtaMinutes)
      : guidanceRoute
        ? Math.round(guidanceRoute.baseEtaMinutes)
        : null;
    if (full == null) return null;
    const totalM = guidanceRouteLengthM;
    if (totalM <= 1 || !guidanceRoute?.geometry?.length) return full;
    const rem = Math.max(0, totalM - userAlongGuidanceM);
    const frac = rem / totalM;
    return Math.max(1, Math.round(full * frac));
  }, [
    navigationStarted,
    scored,
    lineFocusId,
    guidanceRoute,
    guidanceRouteLengthM,
    userAlongGuidanceM,
  ]);

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

  const routeAlertsBuilt = useMemo(
    () => {
      if (!navigationStarted) return [];
      return buildRouteAlerts(
        guidanceRoute?.geometry,
        effectiveUserLngLat,
        guidanceSlice,
        scored.find((s) => s.route.id === lineFocusId),
        Boolean(env.mapboxToken),
        trafficFetchDone,
        { corridorWeatherDetail, trafficLeg: (lineFocusId ? trafficOverlay?.[lineFocusId] : null) ?? null }
      );
    },
    [
      navigationStarted,
      guidanceRoute?.geometry,
      effectiveUserLngLat,
      guidanceSlice,
      scored,
      lineFocusId,
      env.mapboxToken,
      trafficFetchDone,
      corridorWeatherDetail,
    ]
  );

  /** Strip + map corridors: honor the Road checkbox — do not force “on” in drive (that hid toggles but left layers active). */
  const showTrafficCorridorOnRoute = isPlus && roadAdvisoryDetailOn && settingTrafficEnabled;
  const showRoadNoticesOnRoute = isPlus && roadAdvisoryDetailOn;

  useRadarBandsAlongRoute(Boolean(radarMapOverlayOn), guidanceRoute?.geometry);

  /** Road impacts + traffic checkbox + Plus + Traffic setting: corridor traffic on route / strip; otherwise hide traffic segments. */
  const routeAlerts = useMemo(() => {
    let base = routeAlertsBuilt;
    /* Keep weather under NWS/radar surfaces; Road impacts should remain road + traffic only. */
    base = base.filter((a) => a.corridorKind !== "weather");
    if (!showTrafficCorridorOnRoute) {
      base = base.filter((a) => a.corridorKind !== "traffic");
    }
    if (!showRoadNoticesOnRoute) {
      base = base.filter((a) => a.corridorKind !== "hazard" && a.corridorKind !== "notice");
    }
    return base;
  }, [
    routeAlertsBuilt,
    showTrafficCorridorOnRoute,
    showRoadNoticesOnRoute,
  ]);

  const trafficBypassContext = useMemo(
    () =>
      computeTrafficBypassOffer(
        guidanceRoute?.geometry,
        effectiveUserLngLat,
        routeAlerts,
        trafficDelayMinutesForBypass
      ),
    [guidanceRoute?.geometry, effectiveUserLngLat, routeAlerts, trafficDelayMinutesForBypass]
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
    if (viewMode !== "drive") return plan.routes;
    const active = plan.routes.find((r) => r.id === guidanceRouteId);
    if (active) return [active];
    return plan.routes.length ? [plan.routes[0]!] : [];
  }, [viewMode, guidanceRouteId, plan.routes]);
  const progressRailRoute = guidanceRoute ?? driveMapRoutes[0] ?? plan.routes[0];

  /** Map pins during bypass compare — stagger along each polyline so labels don’t stack. */
  const trafficBypassCompareCallouts = useMemo((): TrafficBypassCompareCallout[] | null => {
    if (!trafficBypassCompare) return null;
    const { etaA, etaB, etaC, hasB, hasC } = trafficBypassCompare;
    const frac: Record<string, number> = { "r-a": 0.36, "r-b": 0.44, "r-c": 0.52 };
    const out: TrafficBypassCompareCallout[] = [];
    for (const r of plan.routes) {
      if (r.id !== "r-a" && r.id !== "r-b" && r.id !== "r-c") continue;
      if (r.id === "r-b" && !hasB) continue;
      if (r.id === "r-c" && !hasC) continue;
      const g = r.geometry;
      if (!g?.length) continue;
      const t = frac[r.id] ?? 0.4;
      const p = pointAlongPolyline(g, t);
      if (!p) continue;
      const eta = r.id === "r-a" ? etaA : r.id === "r-b" ? etaB! : etaC!;
      const slot: "A" | "B" | "C" = r.id === "r-a" ? "A" : r.id === "r-b" ? "B" : "C";
      const savingsVsAMinutes = r.id === "r-a" ? null : etaA - eta;
      out.push({ routeId: r.id, lngLat: p, slot, etaMinutes: eta, savingsVsAMinutes });
    }
    return out.length ? out : null;
  }, [trafficBypassCompare, plan.routes]);

  const postedMph = estimatePostedSpeedMph(speedMph, turnSteps, activeTurnIndex);

  const progressStripAlerts = useMemo(() => augmentAlertsForProgressStrip(routeAlerts), [routeAlerts]);

  /** Map line highlights: same corridor layout as the progress strip (traffic, weather, road notices). */
  const mapAlongRouteAlerts = useMemo(() => {
    const g = guidanceRoute?.geometry;
    if (!g?.length) return [];
    const totalM = polylineLengthMeters(g);
    if (totalM <= 0) return [];
    return layoutStripAlerts(progressStripAlerts, g, userAlongGuidanceM, totalM);
  }, [progressStripAlerts, guidanceRoute?.geometry, userAlongGuidanceM]);

  /**
   * Rt/Mp: full corridor/browse polygons. Dr + Plus: prefer polygons overlapping the active leg.
   * If overlap → feature id mapping yields nothing (edge cases), fall back to corridor data so the map
   * doesn’t go blank while the strip still shows alerts.
   */
  const stormMapGeoJsonForMap = useMemo(() => {
    if (!stormMapGeoJson?.features?.length) return null;
    const g = nwsNavCorridorGeom;
    if (!driveModeUi || !g?.length) return stormMapGeoJson;
    const o = computeRouteOverlapWithAlerts(g, stormCorridorAlerts);
    const ids = new Set(o.overlappingIds);
    const filtered = stormMapGeoJson.features.filter((f) => {
      const id = String((f.properties as { id?: string } | undefined)?.id ?? "");
      return id && ids.has(id);
    });
    if (filtered.length > 0) {
      return { type: "FeatureCollection" as const, features: filtered };
    }
    return stormMapGeoJson;
  }, [stormMapGeoJson, driveModeUi, nwsNavCorridorGeom, nwsNavCorridorGeomKey, stormCorridorAlerts]);

  /** Map NWS layer: full set only when Plus detail is on; otherwise life-safety-class only. */
  const driveMapWeatherAlertGeoJson = useMemo(() => {
    if (!advisoryLifeSafetyOn) return null;
    const base = stormMapGeoJsonForMap ?? stormMapGeoJson;
    if (!base) return null;
    if (advisoryPlusDetailOn) return base;
    const filtered = filterMapGeoJsonToBasicEmergencies(base, stormCorridorAlerts);
    if (!filtered?.features?.length) return null;
    return filtered;
  }, [advisoryLifeSafetyOn, advisoryPlusDetailOn, stormMapGeoJsonForMap, stormMapGeoJson, stormCorridorAlerts]);

  const stormProgressBands = useMemo(() => {
    const g = nwsNavCorridorGeom;
    if (!g?.length) return [];
    const geo = advisoryPlusDetailOn
      ? stormMapGeoJsonForMap ?? stormMapGeoJson
      : filterMapGeoJsonToBasicEmergencies(stormMapGeoJsonForMap ?? stormMapGeoJson, stormCorridorAlerts);
    if (!geo?.features?.length) return [];
    return stormAlongBandsForProgressStrip(g, geo);
  }, [advisoryPlusDetailOn, nwsNavCorridorGeom, nwsNavCorridorGeomKey, stormMapGeoJson, stormMapGeoJsonForMap, stormCorridorAlerts]);

  /** Drive HUD: NWS + corridor alerts ahead (Plus gets NWS bands; corridor alerts for all tiers). */
  const driveRouteAheadLine = useMemo(() => {
    if (!driveModeUi) return null;
    const g = guidanceRoute?.geometry;
    if (!g?.length) return null;
    const totalM = polylineLengthMeters(g);
    if (totalM <= 1) return null;
    return buildDriveRouteAheadLine({
      totalM,
      userAlongM: userAlongGuidanceM,
      planEtaMinutes: guidanceRoute?.baseEtaMinutes,
      stormBands: stormProgressBands,
      laidOutAlerts: mapAlongRouteAlerts,
    });
  }, [
    driveModeUi,
    guidanceRoute?.geometry,
    guidanceRoute?.baseEtaMinutes,
    userAlongGuidanceM,
    stormProgressBands,
    mapAlongRouteAlerts,
  ]);

  /**
   * Route broken into distance/time chunks (start at bottom of panel, destination toward top).
   * Long legs: sliding window follows `userAlongM` so older segments scroll away as you drive.
   */
  const progressCalloutItems = useMemo(() => {
    const g = guidanceRoute?.geometry;
    if (!g?.length) return [];
    const totalM = polylineLengthMeters(g);
    if (totalM <= 0) return [];

    if (!navigationStarted) {
      const pt = totalM > 0 ? Math.min(1, Math.max(0, userAlongGuidanceM / totalM)) : 0.5;
      const b = buildSimpleCalloutBlock("Route conditions", [
        "Press Go to load live traffic, weather, and NWS for your active route (primary leg).",
      ]);
      return [
        {
          key: "callout-pre-go",
          title: b.title,
          summary: b.summary,
          tooltip: b.tooltip,
          color:
            guidanceRoute != null
              ? routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds))
              : "#94a3b8",
          alongT: pt,
          alongPct: Math.round(pt * 100),
        },
      ];
    }

    const laidOut = layoutStripAlerts(progressStripAlerts, g, userAlongGuidanceM, totalM);
    const planEta = guidanceRoute?.baseEtaMinutes ?? null;
    const stripTint =
      guidanceRoute != null
        ? routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds))
        : "#94a3b8";
    const wxSamples = weatherOverlay?.[guidanceRouteId]?.samples;

    const chunkItems = buildRouteChunkCalloutList({
      geometry: g,
      totalM,
      userAlongM: userAlongGuidanceM,
      planEtaMinutes: planEta,
      slice: guidanceSlice,
      weatherSamples: wxSamples,
      laidOutAlerts: laidOut,
      stormBands: stormProgressBands,
      stripTint,
      stormNwsAlerts: stormCorridorAlerts,
      progressTrafficLine: liveTrafficNarrative?.progressStartLine ?? null,
    });

    if (chunkItems.length > 0) return chunkItems;

    const pt = totalM > 0 ? Math.min(1, Math.max(0, userAlongGuidanceM / totalM)) : 0.5;
    const b = buildSimpleCalloutBlock("Route conditions", [
      "No weather samples yet — set OpenWeather key to load corridor conditions.",
      "Road and traffic still come from Mapbox / route notices when enabled.",
    ]);
    return [
      {
        key: "callout-fallback",
        title: b.title,
        summary: b.summary,
        tooltip: b.tooltip,
        color: stripTint,
        alongT: pt,
        alongPct: Math.round(pt * 100),
      },
    ];
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

  /** Open panel with “Start route” at the bottom of the scroll area (list reads ahead toward the top). */
  useLayoutEffect(() => {
    const wasOpen = progressCalloutWasOpenRef.current;
    progressCalloutWasOpenRef.current = progressCalloutsOpen;
    if (progressCalloutsOpen && !wasOpen && progressCalloutItems.length > 0) {
      const el = progressCalloutTrackRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
  }, [progressCalloutsOpen, progressCalloutItems.length]);

  const onStormSessionToggle = useCallback((on: boolean) => {
    setStormSessionOn(on);
    try {
      localStorage.setItem("storm-advisory-session", on ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, []);

  const onRoadAdvisoryDetailToggle = useCallback((on: boolean) => {
    setRoadAdvisoryDetailOn(on);
    try {
      localStorage.setItem("stormpath-road-advisory-detail", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const onStormBarExpandedChange = useCallback((expanded: boolean) => {
    setStormBarExpanded(expanded);
    try {
      localStorage.setItem("stormpath-storm-advisory-bar-expanded", expanded ? "1" : "0");
    } catch {
      /* ignore */
    }
    setFitTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-storm-enabled", settingStormEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!settingStormEnabled) {
      // Ensure we stop storm polling immediately.
      stormMapHasDisplayableRef.current = false;
      setStormLoading(false);
      setStormError(null);
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormBarExpanded(false);
      try {
        localStorage.setItem("stormpath-storm-advisory-bar-expanded", "0");
      } catch {
        /* ignore */
      }
    }
  }, [settingStormEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-traffic-enabled", settingTrafficEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!settingTrafficEnabled) setTrafficOverlay(undefined);
  }, [settingTrafficEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-weather-hints-enabled", settingWeatherHintsEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!settingWeatherHintsEnabled) setWeatherOverlay(undefined);
  }, [settingWeatherHintsEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-auto-reroute-enabled", settingAutoRerouteEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [settingAutoRerouteEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-radar-enabled", settingRadarEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!settingRadarEnabled) setShowRadar(false);
  }, [settingRadarEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-voice-guided", settingVoiceGuidanceEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [settingVoiceGuidanceEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-gps-high-refresh", settingGpsHighRefreshEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [settingGpsHighRefreshEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("stormpath-setting-landscape-side-hand", settingLandscapeSideHand);
    } catch {
      /* ignore */
    }
  }, [settingLandscapeSideHand]);

  useEffect(() => {
    stormMapHasDisplayableRef.current = Boolean(stormMapGeoJson?.features?.length);
  }, [stormMapGeoJson]);

  /**
   * US NWS: after Go — active (slot A) route corridor + upwind context. Before Go — viewport browse
   * around GPS so Storm/NWS is not permanently empty (was effectively 0% unless navigating).
   */
  useEffect(() => {
    if (routing) return;
    if (!isPlus || !env.stormAdvisoryEnabled || !advisoryLifeSafetyOn) {
      stormMapHasDisplayableRef.current = false;
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormError(null);
      setStormLoading(false);
      return;
    }
    if (!isOnline) {
      setStormLoading(false);
      return;
    }

    if (!navigationStarted && !effectiveUserLngLat) {
      stormMapHasDisplayableRef.current = false;
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormError(null);
      setStormLoading(false);
      return;
    }

    if (navigationStarted) {
      const g = nwsNavCorridorGeomRef.current;
      if (!g || g.length < 2) {
        stormMapHasDisplayableRef.current = false;
        setStormMapGeoJson(null);
        setStormCorridorAlerts([]);
        setStormOverlapping([]);
        setStormError(null);
        setStormLoading(false);
        return;
      }
    }

    const genAtStart = ++nwsFetchGenRef.current;
    let cancelled = false;

    const run = async () => {
      if (nwsFetchGenRef.current !== genAtStart) return;
      if (!stormMapHasDisplayableRef.current) setStormLoading(true);
      setStormError(null);

      try {
        if (navigationStarted) {
          const geom = nwsNavCorridorGeomRef.current;
          if (!geom || geom.length < 2) {
            if (!cancelled && nwsFetchGenRef.current === genAtStart) {
              setStormCorridorAlerts([]);
              setStormMapGeoJson(null);
              setStormOverlapping([]);
              setStormError(null);
              setStormLoading(false);
            }
            return;
          }
          const corridor = await fetchNwsAlertsForRouteCorridor(geom, NWS_REQUEST_USER_AGENT);
          if (cancelled || nwsFetchGenRef.current !== genAtStart) return;
          setStormCorridorAlerts(corridor.alerts);
          setStormMapGeoJson(corridor.mapGeoJson);
          const o = computeRouteOverlapWithAlerts(geom, corridor.alerts);
          setStormOverlapping(corridor.alerts.filter((a) => o.overlappingIds.includes(a.id)));
        } else {
          const p = effectiveUserLngLatRef.current;
          if (!p) {
            if (!cancelled && nwsFetchGenRef.current === genAtStart) {
              setStormCorridorAlerts([]);
              setStormMapGeoJson(null);
              setStormOverlapping([]);
              setStormError(null);
              setStormLoading(false);
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
          setStormMapGeoJson(null);
          setStormCorridorAlerts([]);
          setStormOverlapping([]);
        }
      } finally {
        if (!cancelled && nwsFetchGenRef.current === genAtStart) setStormLoading(false);
      }
    };
    void run();
    const id = window.setInterval(run, 120_000);
    return () => {
      cancelled = true;
      nwsFetchGenRef.current += 1;
      window.clearInterval(id);
    };
  }, [
    isPlus,
    env.stormAdvisoryEnabled,
    nwsNavCorridorGeomKey,
    navigationStarted,
    advisoryLifeSafetyOn,
    settingStormEnabled,
    isOnline,
    plan.routes.length,
    routing,
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

  /** Lateral distance to polyline — lower = flag off-route sooner so auto-reroute fires faster. */
  const OFF_ROUTE_SEVERE_ENTER_M = 40;
  const OFF_ROUTE_SEVERE_EXIT_M = 18;

  useEffect(() => {
    if (!navigationStarted || !guidanceRoute?.geometry?.length || !userLngLat || !destLngLat) {
      offRouteLatchedRef.current = false;
      lastOffRouteSampleRef.current = null;
      setOffRouteSevere(false);
      return;
    }
    const { lateralMetersApprox, alongMeters } = closestAlongRouteMeters(
      userLngLat,
      guidanceRoute.geometry
    );
    const totalM =
      guidanceRouteLengthM > 0 ? guidanceRouteLengthM : polylineLengthMeters(guidanceRoute.geometry);
    const nearingEnd = totalM > 0 && alongMeters > totalM - 45;
    if (nearingEnd) {
      offRouteLatchedRef.current = false;
      setOffRouteSevere(false);
      return;
    }
    const lat = lateralMetersApprox;
    const now = Date.now();
    const prev = lastOffRouteSampleRef.current;
    lastOffRouteSampleRef.current = { t: now, lateralM: lat, alongM: alongMeters };
    if (offRouteLatchedRef.current) {
      if (lat < OFF_ROUTE_SEVERE_EXIT_M) {
        offRouteLatchedRef.current = false;
        setOffRouteSevere(false);
      }
    } else if (lat > OFF_ROUTE_SEVERE_ENTER_M) {
      offRouteLatchedRef.current = true;
      setOffRouteSevere(true);
    }

    // Fast-path reroute: if you’re drifting away from the line, reroute sooner (don’t wait for “severe”).
    const OFF_ROUTE_FAST_ENTER_M = 20;
    const FAST_SAMPLE_MAX_AGE_MS = 2_200;
    const FAST_REROUTE_THROTTLE_MS = 600;
    const driftingAway =
      prev != null &&
      now - prev.t < FAST_SAMPLE_MAX_AGE_MS &&
      lat > OFF_ROUTE_FAST_ENTER_M &&
      lat - prev.lateralM > 5;
    if (
      settingAutoRerouteEnabled &&
      navigationStarted &&
      !routing &&
      driftingAway &&
      now - lastSevereAutoRecalcMsRef.current > FAST_REROUTE_THROTTLE_MS &&
      (env.mapboxToken ? isOnline : true)
    ) {
      lastSevereAutoRecalcMsRef.current = now;
      void recalcRouteFromHere({ silent: true });
    }
  }, [
    navigationStarted,
    guidanceRoute?.geometry,
    guidanceRouteLengthM,
    userLngLat,
    destLngLat,
    recalcRouteFromHere,
    routing,
    settingAutoRerouteEnabled,
    env.mapboxToken,
    isOnline,
  ]);

  const refreshAltRef = useRef(refreshAlternateRoutesOnly);
  refreshAltRef.current = refreshAlternateRoutesOnly;
  const routingRef = useRef(routing);
  routingRef.current = routing;

  /** Rt: keep primary leg fixed; refresh alternate legs on an interval */
  useEffect(() => {
    if (!navigationStarted) return;
    if (viewMode !== "route") return;
    if (!destLngLat) return;
    const id = window.setInterval(() => {
      if (routingRef.current) return;
      void refreshAltRef.current();
    }, NAV_ROUTE_ALT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [navigationStarted, viewMode, destLngLat]);

  /** Far off-route: silent reroute from current GPS when the setting is on (default). */
  useEffect(() => {
    if (!settingAutoRerouteEnabled) return;
    if (!navigationStarted || !offRouteSevere) return;
    if (routing) return;
    if (env.mapboxToken && !isOnline) return;
    const now = Date.now();
    if (now - lastSevereAutoRecalcMsRef.current < NAV_SEVERE_OFF_ROUTE_THROTTLE_MS) return;
    lastSevereAutoRecalcMsRef.current = now;
    void recalcRouteFromHere({ silent: true });
  }, [
    settingAutoRerouteEnabled,
    offRouteSevere,
    navigationStarted,
    routing,
    recalcRouteFromHere,
    env.mapboxToken,
    isOnline,
  ]);

  useEffect(() => {
    if (!navigationStarted || viewMode !== "drive") return;
    if (!guidanceRoute?.geometry?.length || !userLngLat) return;
    const pick = pickDriveAheadCandidate(
      true,
      guidanceRoute.geometry,
      userLngLat,
      routeAlerts,
      { seriousOnly: true }
    );
    if (!pick) return;
    if (seriousHazardAutoFlewRef.current.has(pick.alert.id)) return;
    seriousHazardAutoFlewRef.current.add(pick.alert.id);
    setMapFocus({
      kind: "hazardOverview",
      hazardLng: pick.alert.lngLat[0]!,
      hazardLat: pick.alert.lngLat[1]!,
    });
  }, [navigationStarted, viewMode, guidanceRoute?.geometry, guidanceRouteId, userLngLat, routeAlerts]);

  /** Rt + Mp: explore / plan on the map; Dr is follow-cam — keep tap-to-dest and ★ off there. */
  const mapPlanningUi = viewMode === "route" || viewMode === "topdown";
  const allowDestinationPick = mapPlanningUi;
  const routeActive = plan.routes.length > 0;
  const showCompactDest = routeActive && !searchExpanded;

  /** Advisory strip always available for Plus life-safety; Basic follows Storm setting. */
  const showStormAdvisoryChrome = advisoryLifeSafetyOn;

  /** NWS polygons containing current position when the route polyline may not register an intersection. */
  const stormNwsPuckInside = useMemo(() => {
    const p = effectiveUserLngLat;
    if (!p?.length || !stormCorridorAlerts.length) return [];
    const [lng, lat] = p;
    return stormCorridorAlerts.filter(
      (a) => a.geometry && pointInAnyPolygonGeometry(lng, lat, a.geometry)
    );
  }, [effectiveUserLngLat, stormCorridorAlerts]);

  const stormHazardPeekBadge = useMemo(() => {
    if (!advisoryLifeSafetyOn || stormLoading || stormError) return null;
    const overlap = advisoryPlusDetailOn
      ? stormOverlapping
      : stormOverlapping.filter(nwsAlertIsBasicEmergency);
    const atPuck = advisoryPlusDetailOn
      ? stormNwsPuckInside
      : stormNwsPuckInside.filter(nwsAlertIsBasicEmergency);
    const ids = new Set<string>();
    for (const a of overlap) ids.add(a.id);
    for (const a of atPuck) ids.add(a.id);
    if (ids.size === 0) return null;
    return ids.size;
  }, [advisoryLifeSafetyOn, advisoryPlusDetailOn, stormLoading, stormError, stormOverlapping, stormNwsPuckInside]);

  /** Same A/B/C slot color as the focused route line on the map (see routeSlotIndexFor / applyRoutesToMap). */
  const progressStripRouteColor = useMemo(() => {
    if (!guidanceRoute) return routePickSlotHex(0);
    return routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds));
  }, [guidanceRoute, orderedRouteIds]);

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
      showOnMap: activityTrailMapOn,
      onShowOnMapChange: (on: boolean) => {
        setActivityTrailMapOn(on);
        try {
          localStorage.setItem(ACTIVITY_TRAIL_MAP_LS, on ? "1" : "0");
        } catch {
          /* ignore */
        }
      },
      onClear: () => {
        clearActivitySamples();
        setActivityTrailTick((n) => n + 1);
      },
    };
  }, [isPlus, activityTrailMapOn, activityTrailTick]);

  const clearRoute = () => {
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
    setViewMode("route");
    setShowRadar(false);
    setRouteHazardSheet(null);
    setMapFocus(null);
    setBypassBusy(false);
    setRouting(false);
    setTrafficBypassCompare(null);
    setDemoPlaybackAlongM(null);
    void clearActiveTripCache();
  };

  const clearRouteRef = useRef(clearRoute);
  clearRouteRef.current = clearRoute;

  /** Bump on any real user input — resets arrival idle countdown. */
  useEffect(() => {
    const bump = () => {
      lastUserInteractionMsRef.current = Date.now();
      arrivalIdleStartMsRef.current = null;
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
      tabHiddenAtMsRef.current = null;
      clearRouteRef.current();
      setTapHint("You've arrived — trip cleared.");
      window.setTimeout(() => setTapHint(null), 5000);
    };
    const tick = () => {
      if (demoBypassTrafficJamPlusRef.current) return;
      if (!navigationStartedRef.current) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const pos = userLngLatRef.current;
      const dest = destLngLatRef.current;
      if (!pos || !dest) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const d = haversineMeters(pos, dest);
      if (d > ARRIVAL_DEST_RADIUS_M) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const speed = speedMpsRef.current;
      if (speed != null && Number.isFinite(speed) && speed > ARRIVAL_STATIONARY_MAX_SPEED_MPS) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const now = Date.now();
      if (now - lastUserInteractionMsRef.current < 3500) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      if (arrivalIdleStartMsRef.current == null) {
        arrivalIdleStartMsRef.current = now;
        return;
      }
      if (now - arrivalIdleStartMsRef.current >= ARRIVAL_IDLE_CLEAR_MS) {
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
      const dist = haversineMeters(pos, dest);
      if (dist > ARRIVAL_DEST_RADIUS_M) return;
      const speed = speedMpsRef.current;
      if (speed != null && Number.isFinite(speed) && speed > ARRIVAL_STATIONARY_MAX_SPEED_MPS) return;
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

  const handleTrafficBypassComparePick = useCallback(
    (id: "r-a" | "r-b" | "r-c") => {
      handlePromoteRouteToPrimary(id);
      setTrafficBypassCompare(null);
      setViewMode("drive");
      setFitTrigger((n) => n + 1);
    },
    [handlePromoteRouteToPrimary]
  );

  const handleTrafficBypassCompareCancel = useCallback(() => {
    setTrafficBypassCompare(null);
    setViewMode("drive");
    setFitTrigger((n) => n + 1);
  }, []);

  const advanceDemoPlaybackAlongRoute = useCallback(() => {
    if (!demoBypassTrafficJamPlus || !guidanceRoute?.geometry?.length) return;
    const g = guidanceRoute.geometry;
    const totalM = polylineLengthMeters(g);
    if (totalM < 2) return;
    const pos = userLngLatRef.current;
    const cur =
      demoPlaybackAlongM ??
      (pos ? closestAlongRouteMeters(pos, g).alongMeters : totalM * 0.12);
    setDemoPlaybackAlongM(Math.min(totalM - 0.5, cur + 420));
  }, [demoBypassTrafficJamPlus, guidanceRoute?.geometry, demoPlaybackAlongM]);

  const resetDemoPlaybackAlongRoute = useCallback(() => {
    setDemoPlaybackAlongM(null);
  }, []);

  const handleGo = () => {
    const chosen = orderedRouteIds[previewLegIndex] ?? orderedRouteIds[0] ?? primaryRouteId;
    if (!chosen) return;
    setRouteSlotOrder((prev) => slotOrderAfterSelect(prev.length ? prev : planRouteIds, chosen));
    setPreviewLegIndex(0);
    setNavigationStarted(true);
    setViewMode("drive");
    setFitTrigger((n) => n + 1);

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
  };

  const flushMapFocus = useCallback(() => {
    setMapFocus(null);
  }, []);

  const handleDriveCameraBearingDeg = useCallback((deg: number | null) => {
    setDriveMapBearingDeg(deg);
  }, []);

  const handleTryAlternateRoute = useCallback(() => {
    if (!alternateBypassRouteId) {
      setTapHint("No other route to try — open Rt view or Stop and set a new destination.");
      window.setTimeout(() => setTapHint(null), 5000);
      return;
    }
    setRouteSlotOrder((prev) =>
      slotOrderAfterSelect(prev.length ? prev : planRouteIds, alternateBypassRouteId)
    );
    setPreviewLegIndex(0);
    setTapHint("Alternate route active — map and guidance updated.");
    window.setTimeout(() => setTapHint(null), 5500);
  }, [alternateBypassRouteId, planRouteIds]);

  const handleQuickReportIssue = useCallback(() => {
    const to = env.supportEmail?.trim();
    if (!to) {
      const site = env.supportUrl?.trim();
      if (site) window.open(site, "_blank", "noopener,noreferrer");
      return;
    }
    const subject = encodeURIComponent(`StormPath quick issue report (${__APP_VERSION__})`);
    const quickDiag = [
      `App: StormPath ${__APP_VERSION__}`,
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
      const totalM = polylineLengthMeters(geom);
      const alongM = Math.max(0, Math.min(totalM, Number.isFinite(userAlongGuidanceM) ? userAlongGuidanceM : totalM * 0.5));
      const lngLat = pointAtAlongMeters(geom, alongM);
      setRouteHazardSheet({
        routeId: lineFocusId,
        alerts: [normalizedWeatherToRouteAlert(alert, lngLat, alongM)],
      });
    },
    [guidanceRoute?.geometry, lineFocusId, userAlongGuidanceM]
  );

  const handleTrafficBypassFromHere = useCallback(async () => {
    if (!isPlus) return;
    if (!env.mapboxToken || !userLngLat || !destLngLat || !guidanceRoute?.geometry?.length) return;
    const epochAtStart = routeGraphEpochRef.current;
    setBypassBusy(true);
    const geom = guidanceRoute.geometry;
    const totalM = polylineLengthMeters(geom);
    const MI = 1_609.34;

    try {
      const trafficAlert = routeAlerts.find(
        (a) => (a.id === "traffic-delay" || a.id === "traffic") && a.promptRerouteAhead
      );
      const jamAlongM = trafficAlert?.alongMeters ?? totalM * 0.38;

      const [fullRerouteP, surgicalP] = await Promise.all([
        fetchMapboxTrafficAlternatives(env.mapboxToken, userLngLat, destLngLat),
        (async (): Promise<{
          geometry: LngLat[];
          baseEtaMinutes: number;
          turnSteps: { instruction: string; distanceM?: number }[];
          notice: string;
        } | null> => {
          const exitM = Math.max(0, jamAlongM - 2 * MI);
          const rejoinM = Math.min(totalM, jamAlongM + 3 * MI);
          if (rejoinM - exitM < 1 * MI) return null;
          const exitPt = pointAtAlongMeters(geom, exitM);
          const rejoinPt = pointAtAlongMeters(geom, rejoinM);
          const seg = await fetchMapboxSurgicalBypass(env.mapboxToken, exitPt, rejoinPt);
          if (!seg?.geometry?.length) return null;

          const pre = slicePolylineBetweenAlong(geom, 0, exitM);
          const post = slicePolylineBetweenAlong(geom, rejoinM, totalM);
          const spliced: LngLat[] = [...pre, ...seg.geometry, ...post];
          if (spliced.length < 2) return null;

          const preRatio = totalM > 0 ? exitM / totalM : 0;
          const postRatio = totalM > 0 ? (totalM - rejoinM) / totalM : 0;
          const baseEta = guidanceRoute.baseEtaMinutes;
          const splicedEta = baseEta * preRatio + seg.durationMinutes + baseEta * postRatio;

          return {
            geometry: spliced,
            baseEtaMinutes: Math.max(1, Math.round(splicedEta)),
            turnSteps: [
              ...(pre.length ? [{ instruction: "Continue on current route to exit" }] : []),
              ...seg.turnSteps,
              ...(post.length ? [{ instruction: "Rejoin highway and continue to destination" }] : []),
            ],
            notice: "Side-road bypass around traffic (exit \u2192 rejoin).",
          };
        })(),
      ]);

      const alts = fullRerouteP;
      const bestFull = alts
        ?.slice()
        .sort((a, b) => a.durationMinutes - b.durationMinutes)[0];

      if (!bestFull && !surgicalP) {
        setTapHint("No alternate routes available right now. Try again closer to the slowdown.");
        window.setTimeout(() => setTapHint(null), 6000);
        return;
      }

      if (bestFull || surgicalP) {
        if (epochAtStart !== routeGraphEpochRef.current) return;
        setPlan((prev) => ({
          ...prev,
          routes: prev.routes.map((r) => {
            if (r.id === "r-b" && bestFull) {
              return {
                ...r,
                label: "No interstate · reroute",
                geometry: bestFull.geometry,
                baseEtaMinutes: Math.max(1, Math.round(bestFull.durationMinutes)),
                turnSteps: bestFull.turnSteps,
                routeNotices: [
                  ...(r.routeNotices ?? []),
                  "Full reroute via Mapbox live traffic.",
                ],
              };
            }
            if (r.id === "r-c" && surgicalP) {
              return {
                ...r,
                label: "Scenic · bypass",
                geometry: surgicalP.geometry,
                baseEtaMinutes: surgicalP.baseEtaMinutes,
                turnSteps: surgicalP.turnSteps,
                routeNotices: [
                  ...(r.routeNotices ?? []),
                  surgicalP.notice,
                ],
              };
            }
            return r;
          }),
        }));
      }

      setFitTrigger((n) => n + 1);
      setTrafficBypassCompare({
        headline: trafficBypassContext?.headline ?? "Traffic ahead",
        etaA: Math.round(guidanceRoute.baseEtaMinutes),
        etaB: bestFull ? Math.round(bestFull.durationMinutes) : null,
        etaC: surgicalP ? surgicalP.baseEtaMinutes : null,
        hasB: Boolean(bestFull),
        hasC: Boolean(surgicalP),
      });
      setViewMode("topdown");
    } catch {
      setTapHint("Bypass request failed.");
      window.setTimeout(() => setTapHint(null), 5000);
    } finally {
      setBypassBusy(false);
    }
  }, [
    isPlus,
    env.mapboxToken,
    userLngLat,
    destLngLat,
    guidanceRoute,
    routeAlerts,
    trafficBypassContext,
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
      const p = pointAlongPolyline(guidanceRoute.geometry, tLeg?.nearStopFraction ?? 0.38);
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
    const betterRouteEta = betterRoute
      ? scored.find((s) => s.route.id === betterRoute)?.effectiveEtaMinutes ?? null
      : null;
    const tLeg = trafficOverlay?.[guidanceRouteId];
    const hasTrafficStop = Boolean(tLeg?.nearStopFraction != null || tLeg?.hasClosure);

    if (navigationStarted) {
      rows.unshift({
        label: "Trip status",
        text: (
          <>
            <strong>{driveEtaMinutes != null ? `${formatEtaDuration(driveEtaMinutes)} to go` : "Trip active"}</strong>{" "}
            <span className="storm-advisory-bar__road-muted">
              {driveEtaMinutes != null ? "on current route" : "ETA updating"}
            </span>
          </>
        ),
      });
    }

    if (hasTrafficStop) {
      rows.push({
        label: "Traffic stop",
        text: <strong>Stopped/blocked traffic detected on your route</strong>,
        actionLabel: "Show stop",
        onAction: handleInspectTrafficStop,
      });
    }

    if (betterRoute) {
      rows.push({
        label: "Better route",
        text: (
          <>
            <strong>{betterRoute.toUpperCase()}</strong>{" "}
            <span className="storm-advisory-bar__road-muted">
              {betterRouteEta != null ? `may save about ${formatEtaDuration(Math.max(1, Math.round((driveEtaMinutes ?? betterRouteEta) - betterRouteEta)))}.` : "worth checking now."}
            </span>
          </>
        ),
      });
    }

    return rows;
  }, [
    stormRoadDetailRows,
    suggestedRouteId,
    guidanceRouteId,
    scored,
    trafficOverlay,
    navigationStarted,
    driveEtaMinutes,
    handleInspectTrafficStop,
  ]);

  /** Busy message for the always-visible activity chip (null → shows muted Idle). */
  const activityBusyLabel = useMemo(() => {
    const trafficBusy =
      isPlus &&
      navigationStarted &&
      plan.routes.length > 0 &&
      !trafficFetchDone &&
      settingTrafficEnabled &&
      Boolean(env.mapboxToken) &&
      isOnline;

    const stormBusy = stormLoading && advisoryLifeSafetyOn;

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
    advisoryLifeSafetyOn,
    isPlus,
  ]);

  return (
    <div
      className={`app-shell nav-fullmap${navigationStarted && viewMode === "drive" ? " nav-drive-ui" : ""}${
        basemapNight ? " app-shell--basemap-night" : ""
      }${settingLandscapeSideHand === "left" ? " app-shell--landscape-hand-left" : ""}`}
    >
      {import.meta.env.DEV ? (
        <div
          className="stormpath-build-stamp"
          title="If this text does not match the build your assistant just set, the page is stale — hard refresh or restart dev server."
          aria-label={`StormPath build ${STORMPATH_CLIENT_BUILD}`}
        >
          {STORMPATH_CLIENT_BUILD}
        </div>
      ) : null}
      <div className="map-stage map-bleed">
        <div className="map-canvas">
          <Suspense fallback={<div className="drive-map" />}>
          <DriveMap
            routes={driveMapRoutes}
            lineFocusId={lineFocusId}
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
            onRadarFrameUtcSec={setRadarFrameUtcSec}
            alongRouteAlerts={mapAlongRouteAlerts}
            corridorRouteGeometry={guidanceRoute?.geometry}
            recordingGeometry={recordingActive ? recordingPathPreview : undefined}
            weatherAlertGeoJson={driveMapWeatherAlertGeoJson}
            stormBarVisible={showStormAdvisoryChrome}
            stormBarExpanded={stormBarExpanded}
            recenterPlanningPuckTick={recenterPlanningPuckTick}
            puckSnapGeometry={
              navigationStarted && guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2
                ? guidanceRoute.geometry
                : null
            }
            trafficConditionsOnMap={Boolean(
              navigationStarted &&
                isPlus &&
                roadAdvisoryDetailOn &&
                settingTrafficEnabled &&
                Boolean(env.mapboxToken)
            )}
            onDriveCameraBearingDeg={handleDriveCameraBearingDeg}
            stormBrowseBoundsReporting={false}
            onStormBrowseBoundsChange={undefined}
            trafficBypassCompareCallouts={trafficBypassCompareCallouts}
            onTrafficBypassCompareFlagPick={
              trafficBypassCompare
                ? (id) => handleTrafficBypassComparePick(id as "r-a" | "r-b" | "r-c")
                : undefined
            }
            activityTrailGeoJson={activityTrailGeoJsonForMap}
            searchPickMarkers={searchPickMarkersForMap}
            onSearchPickMarkerClick={searchPickMarkersForMap ? handleSearchPickFromMap : undefined}
            progressRailVisible={navigationStarted && isPlus}
          />
          </Suspense>
        </div>

        <div className="nav-drive-overlay-stack">
            <div className="nav-top-cluster">
              <div className="nav-top-route-rail">
                <div className="nav-top-route-rail__main">
                  <TopGuidanceBar
                    hasRoute={navigationStarted && plan.routes.length > 0}
                    isPlus={isPlus}
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
                      loading={stormLoading}
                      error={stormError}
                      corridorAlerts={stormCorridorAlerts}
                      overlappingAlerts={
                        advisoryPlusDetailOn
                          ? stormOverlapping
                          : stormOverlapping.filter(nwsAlertIsBasicEmergency)
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
                      barExpanded={stormBarExpanded}
                      onBarExpandedChange={onStormBarExpandedChange}
                      hideHeadToggles={!isPlus}
                      onNwsAlertClick={handleAdvisoryNwsClick}
                      peekBadge={stormHazardPeekBadge}
                      busyLabel={activityBusyLabel}
                      driveRouteAheadLine={driveModeUi ? driveRouteAheadLine : null}
                      advisoryTier={advisoryPlusDetailOn ? "plus" : "basic"}
                      ownsPlus={isPlus}
                      promoLines={advisoryPromoLines}
                      isOnline={isOnline}
                      basicNavAdvisoryMode={!isPlus}
                    />
                  ) : isPlus ? (
                    <div className="nav-top-activity-pill-wrap nav-top-activity-pill-wrap--solo">
                      <ActivityStatusPill busyLabel={activityBusyLabel} />
                    </div>
                  ) : null}
                  
                </div>
              </div>
            </div>
            {navigationStarted &&
              isPlus &&
              progressRailRoute?.geometry &&
              progressRailRoute.geometry.length >= 2 && (
              <div
                className={`nav-route-progress-rail${progressCalloutsOpen && progressCalloutItems.length > 0 ? " nav-route-progress-rail--callouts-open" : ""}`}
              >
                <div className="nav-route-progress-rail__inner">
                  <div
                    className={`route-progress-callout-rail-cluster${
                      progressCalloutsOpen && progressCalloutItems.length > 0
                        ? " route-progress-callout-rail-cluster--open"
                        : ""
                    }`}
                  >
                    {progressCalloutsOpen && progressCalloutItems.length > 0 && (
                      <div
                        className="route-progress-callout-panel route-progress-callout-panel--rail route-progress-callout-panel--with-docked-toggle"
                        role="list"
                        aria-label="Progress bar segments"
                      >
                        <div className="route-progress-callout-panel__track" ref={progressCalloutTrackRef}>
                          {progressCalloutItems.map((it) => (
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
                                <p className="route-progress-callout-panel__summary">{it.summary}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      className={`route-progress-callout-toggle${
                        progressCalloutsOpen ? " route-progress-callout-toggle--on" : ""
                      }${
                        progressCalloutsOpen && progressCalloutItems.length > 0
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
            routeId={routeHazardSheet.routeId}
            focusedRouteId={lineFocusId}
            alerts={routeHazardSheet.alerts}
            alternateRouteAvailable={Boolean(alternateBypassRouteId)}
            bypassCompareAvailable={Boolean(
              env.mapboxToken && userLngLat && destLngLat && guidanceRoute
            )}
            bypassBusy={bypassBusy}
            onClose={() => setRouteHazardSheet(null)}
            onTryAlternateRoute={() => {
              handleTryAlternateRoute();
              setRouteHazardSheet(null);
            }}
            onCompareReroutes={() => {
              setRouteHazardSheet(null);
              void handleTrafficBypassFromHere();
            }}
            onOpenRouteView={() => {
              setViewMode("route");
              setRouteHazardSheet(null);
            }}
            onShowOnMap={(alert) => {
              /* Close the sheet first, drop into map view, and frame the hazard. */
              setRouteHazardSheet(null);
              if (viewMode === "drive") setViewMode("topdown");
              setMapFocus({
                kind: "hazardOverview",
                hazardLng: alert.lngLat[0]!,
                hazardLat: alert.lngLat[1]!,
              });
            }}
            onSelectThisRoute={(id) => {
              handlePromoteRouteToPrimary(id);
              setRouteHazardSheet(null);
            }}
          />
        )}

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
                  try {
                    localStorage.setItem("stormpath-safety-ack-v1", "1");
                  } catch {
                    /* ignore */
                  }
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
                ? "Offline — showing last route. Live updates paused (traffic, weather, storm)."
                : "Offline — showing last route. Reconnect for map tiles and radar."}
          </div>
        )}

        {demoBypassTrafficJamPlus && driveModeUi && navigationStarted && (
          <div className="nav-demo-bypass-banner" role="status" aria-live="polite">
            <span className="nav-demo-bypass-banner__text">
              Plus demo: URL <code>?demo=bypass</code> simulates heavy delay so Traffic bypass is offered. Advance steps the
              puck along your route (replay); Reset returns to live GPS.
            </span>
            <div className="nav-demo-bypass-banner__actions">
              <button type="button" className="nav-demo-bypass-banner__btn" onClick={advanceDemoPlaybackAlongRoute}>
                Advance
              </button>
              <button type="button" className="nav-demo-bypass-banner__btn" onClick={resetDemoPlaybackAlongRoute}>
                Reset puck
              </button>
            </div>
          </div>
        )}

        <div className="nav-bottom-stack">
          {trafficBypassCompare && (
            <TrafficBypassComparePanel
              headline={trafficBypassCompare.headline}
              etaA={trafficBypassCompare.etaA}
              etaB={trafficBypassCompare.etaB}
              etaC={trafficBypassCompare.etaC}
              hasB={trafficBypassCompare.hasB}
              hasC={trafficBypassCompare.hasC}
              onPick={handleTrafficBypassComparePick}
              onCancel={handleTrafficBypassCompareCancel}
            />
          )}
          {recordingActive && (
            <RecordingRouteBanner
              pointCount={recordingPointCount}
              lengthMeters={recordingLengthM}
              onStopSave={handleStopRecordingSave}
              onDiscard={handleDiscardRecordingPath}
            />
          )}
          <div className="nav-bottom-chrome-wrap">
            <div className="nav-bottom-dock">
              {navigationStarted && viewMode === "drive" ? (
                <div className="nav-bottom-dock__about-row">
                  <div className="nav-bottom-dock__drive-about-stack">
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
                </div>
              ) : (
                <div className="nav-bottom-dock__plan-stack">
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
                    {radarMapOverlayOn && radarFrameTimeLabel ? (
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
                    {(viewMode === "route" || viewMode === "topdown") && plan.routes.length === 0 && userLngLat && (
                      <button
                        type="button"
                        className="nav-recenter-puck-btn nav-recenter-puck-btn--dock"
                        title="Center map on your location"
                        aria-label="Center map on your location"
                        onClick={() => setRecenterPlanningPuckTick((n) => n + 1)}
                      >
                        My location
                      </button>
                    )}
                    {viewMode === "route" && routePickItems.length >= 1 && (
                      <div className="nav-bottom-dock__route-toggle-slot">
                        <RouteCycleButton
                          items={routePickItems}
                          selectedId={lineFocusId}
                          cycleOrderIds={planRouteIds}
                          activeSlotIndex={viewMode === "route" ? previewLegIndex : null}
                          onSelect={handlePreviewRouteSelect}
                          detail={routeDockDetail}
                        />
                      </div>
                    )}
                  </div>
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
              showRadarButton={offerRadarChrome}
              offRouteSevere={offRouteSevere}
              showOffRouteBanner={showOffRouteManualBanner}
              onRerouteFromHere={() => void recalcRouteFromHere()}
              showTrafficBypass={showTrafficBypassCta}
              bypassBusy={bypassBusy}
              onTrafficBypass={() => void handleTrafficBypassFromHere()}
            />
          </div>
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
          autoRerouteEnabled: settingAutoRerouteEnabled,
          voiceGuidanceEnabled: settingVoiceGuidanceEnabled,
          gpsHighRefreshEnabled: settingGpsHighRefreshEnabled,
          landscapeSideHand: settingLandscapeSideHand,
        }}
        onSettings={(next) => {
          setSettingRadarEnabled(next.radarEnabled);
          setSettingStormEnabled(next.stormEnabled);
          setSettingTrafficEnabled(next.trafficEnabled);
          setSettingWeatherHintsEnabled(next.weatherHintsEnabled);
          setSettingAutoRerouteEnabled(next.autoRerouteEnabled);
          setSettingVoiceGuidanceEnabled(next.voiceGuidanceEnabled);
          setSettingGpsHighRefreshEnabled(next.gpsHighRefreshEnabled);
          setSettingLandscapeSideHand(next.landscapeSideHand);
          setTapHint(`Settings updated (${tierLabel}).`);
          window.setTimeout(() => setTapHint(null), 2500);
        }}
      />
    </div>
  );
}
