import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { EMPTY_TRIP } from "./emptyTrip";
import {
  isGenericOriginLabel,
  persistReturnTripLegOnGo,
  type ReturnTripLeg,
} from "./returnTripLeg";
import { slotOrderAfterSelect } from "./routeSlotOrder";
import type { LngLat, NavRoute } from "./types";
import { completedTripFromGeometry } from "../frequentRoutes/tripDetector";
import type { CompletedLearnedTrip } from "../frequentRoutes/types";
import {
  areaKeyFromLngLat,
  areaLabelFromDestinationLabel,
  savePreferredAreaRouteMap,
  type PreferredAreaRouteMap,
} from "../preferredAreaRoutes";
import { isPersonalForkRouteId } from "../personalForks";
import { clearActiveTripCache } from "../tripCache";
import { formatCoordsAreaLabel } from "../utils/forecastDisplay";
import {
  setTollCompareContext,
  useRouteCompareStore,
} from "../state/routeCompareStore";
import { useTripPlanStore } from "../state/tripPlanStore";
import { useUiStore } from "../state/uiStore";
import type { SearchSuggestion } from "../ui/SearchBar";

/**
 * Trip Go / Stop lifecycle — Phase 3c.
 *
 * Owns `clearRoute`, `proceedGo`, `handleGo`, and `handleStopAndClear` that used to live
 * inline in `App.tsx`. Store setters are subscribed here; App still owns refs, search
 * setters, and sibling-hook callbacks (same pattern as {@link useComputeRoutes}).
 */

export type UseTripLifecycleDeps = {
  payFrequentRoutes: boolean;
  learnEnabled: boolean;
  tollBypassEnabled: boolean;
  userLngLat: LngLat | null;

  orderedRouteIds: string[];
  primaryRouteId: string;
  planRouteIds: string[];

  recordLearnedTrip: (trip: CompletedLearnedTrip) => void;
  flushActiveLearnedTrip: () => CompletedLearnedTrip | null;
  resetTripLearningMachine: () => void;
  learnFromCompletedNav: (
    planned: LngLat[] | null,
    gpsTrip: CompletedLearnedTrip | null
  ) => void;

  resetOffRouteNavigation: () => void;
  resetNavigationPlanning: () => void;
  bumpRouteForecastRefresh: () => void;

  setAddingViaStop: (v: boolean) => void;
  setSearchText: (v: string) => void;
  setSearchPickHits: (hits: SearchSuggestion[] | null) => void;
  setSuggestions: (items: SearchSuggestion[]) => void;
  setAllowAutocomplete: (v: boolean) => void;
  searchPickQueryRef: MutableRefObject<string | null>;

  setFitTrigger: Dispatch<SetStateAction<number>>;
  setGuidanceGeometryEpoch: Dispatch<SetStateAction<number>>;
  setRecenterPlanningPuckTick: Dispatch<SetStateAction<number>>;
  setReturnTripLeg: (leg: ReturnTripLeg | null) => void;
  setRouting: (busy: boolean) => void;
  setBypassBusy: (busy: boolean) => void;
  setRouteError: (msg: string | null) => void;
  setTollAvoidFailureNote: (note: string | null) => void;
  setDemoPlaybackPlaying: Dispatch<SetStateAction<boolean>>;
  setDemoPlaybackAlongM: (m: number | null) => void;

  navigationStartedRef: MutableRefObject<boolean>;
  navGoStartedAtRef: MutableRefObject<number | null>;
  navGoGeometryRef: MutableRefObject<LngLat[] | null>;
  navPlannedMainGeometryRef: MutableRefObject<LngLat[] | null>;
  navigationGuidanceGeometryRef: MutableRefObject<LngLat[] | null>;
  lockedNavigationRouteIdRef: MutableRefObject<string | null>;
  onPersonalForkRef: MutableRefObject<boolean>;
  routeGraphEpochRef: MutableRefObject<number>;
  routeMainFetchAbortRef: MutableRefObject<AbortController | null>;
  altRoutesFetchAbortRef: MutableRefObject<AbortController | null>;
  seriousHazardAutoFlewRef: MutableRefObject<Set<string>>;
  tollAcceptedRouteIdsRef: MutableRefObject<Set<string>>;
  pendingGoAfterTollRef: MutableRefObject<boolean>;
  preferredAreaRouteMapRef: MutableRefObject<PreferredAreaRouteMap>;
};

export type TripLifecycleActions = {
  clearRoute: () => void;
  proceedGo: () => void;
  handleGo: () => void;
  handleStopAndClear: () => void;
};

/** Pure gate used by handleGo — extracted so tests can lock the toll prompt path. */
export function shouldPromptTollBeforeGo(args: {
  route: NavRoute | undefined;
  tollBypassEnabled: boolean;
  acceptedRouteIds: Set<string>;
  chosenRouteId: string;
}): boolean {
  const { route, tollBypassEnabled, acceptedRouteIds, chosenRouteId } = args;
  return Boolean(
    tollBypassEnabled && route?.hasTolls && !acceptedRouteIds.has(chosenRouteId)
  );
}

export function useTripLifecycle(deps: UseTripLifecycleDeps): TripLifecycleActions {
  const {
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
    learnFromCompletedNav,
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
  } = deps;

  const plan = useTripPlanStore((s) => s.plan);
  const destLngLat = useTripPlanStore((s) => s.destLngLat);
  const destinationLabel = useTripPlanStore((s) => s.destinationLabel);
  const previewLegIndex = useTripPlanStore((s) => s.previewLegIndex);
  const setPlan = useTripPlanStore((s) => s.setPlan);
  const setDestLngLat = useTripPlanStore((s) => s.setDestLngLat);
  const setViaStops = useTripPlanStore((s) => s.setViaStops);
  const setActiveViaIndex = useTripPlanStore((s) => s.setActiveViaIndex);
  const setDestinationLabel = useTripPlanStore((s) => s.setDestinationLabel);
  const setRouteSlotOrder = useTripPlanStore((s) => s.setRouteSlotOrder);
  const setPreviewLegIndex = useTripPlanStore((s) => s.setPreviewLegIndex);
  const setViewMode = useTripPlanStore((s) => s.setViewMode);
  const setNavigationStarted = useTripPlanStore((s) => s.setNavigationStarted);

  const setProgressCalloutsOpen = useUiStore((s) => s.setProgressCalloutsOpen);
  const setSearchExpanded = useUiStore((s) => s.setSearchExpanded);
  const setMapFocus = useUiStore((s) => s.setMapFocus);
  const setRouteHazardSheet = useUiStore((s) => s.setRouteHazardSheet);

  const setTollRoutePrompt = useRouteCompareStore((s) => s.setTollRoutePrompt);
  const setTrafficBypassCompare = useRouteCompareStore((s) => s.setTrafficBypassCompare);

  const clearRoute = useCallback(() => {
    if (navigationStartedRef.current && payFrequentRoutes && learnEnabled) {
      const started = navGoStartedAtRef.current;
      const planned = navPlannedMainGeometryRef.current;
      const geom = navGoGeometryRef.current;
      if (geom && started) {
        const trip = completedTripFromGeometry(geom, started);
        if (trip) recordLearnedTrip(trip);
      }
      const gpsTrip = flushActiveLearnedTrip();
      learnFromCompletedNav(planned, gpsTrip);
      resetTripLearningMachine();
      navGoStartedAtRef.current = null;
      navGoGeometryRef.current = null;
      navPlannedMainGeometryRef.current = null;
    }
    onPersonalForkRef.current = false;
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
  }, [
    payFrequentRoutes,
    learnEnabled,
    navigationStartedRef,
    navGoStartedAtRef,
    navPlannedMainGeometryRef,
    navGoGeometryRef,
    onPersonalForkRef,
    lockedNavigationRouteIdRef,
    routeGraphEpochRef,
    routeMainFetchAbortRef,
    altRoutesFetchAbortRef,
    seriousHazardAutoFlewRef,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    searchPickQueryRef,
    recordLearnedTrip,
    flushActiveLearnedTrip,
    learnFromCompletedNav,
    resetTripLearningMachine,
    resetOffRouteNavigation,
    resetNavigationPlanning,
    setProgressCalloutsOpen,
    setPlan,
    setDestLngLat,
    setViaStops,
    setActiveViaIndex,
    setAddingViaStop,
    setSearchText,
    setDestinationLabel,
    setSearchPickHits,
    setSuggestions,
    setRouteError,
    setSearchExpanded,
    setAllowAutocomplete,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setRecenterPlanningPuckTick,
    setRouteHazardSheet,
    setTollRoutePrompt,
    setTollAvoidFailureNote,
    setMapFocus,
    setBypassBusy,
    setRouting,
    setTrafficBypassCompare,
    setDemoPlaybackPlaying,
    setDemoPlaybackAlongM,
  ]);

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
    /* Keep the Go-time main for fork learning even if we later commit "Your route". */
    if (!isPersonalForkRouteId(chosen) && navGoGeometryRef.current?.length) {
      navPlannedMainGeometryRef.current = navGoGeometryRef.current.map(
        ([a, b]) => [a, b] as LngLat
      );
    } else if (isPersonalForkRouteId(chosen)) {
      const mainAlt =
        plan.routes.find((r) => r.id === "r-a") ??
        plan.routes.find((r) => !isPersonalForkRouteId(r.id));
      navPlannedMainGeometryRef.current = mainAlt?.geometry?.length
        ? mainAlt.geometry.map(([a, b]) => [a, b] as LngLat)
        : navGoGeometryRef.current;
      onPersonalForkRef.current = true;
    } else {
      navPlannedMainGeometryRef.current = navGoGeometryRef.current;
    }
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
    bumpRouteForecastRefresh,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setNavigationStarted,
    setViewMode,
    setFitTrigger,
    setTollRoutePrompt,
    setTollAvoidFailureNote,
    lockedNavigationRouteIdRef,
    navGoStartedAtRef,
    navGoGeometryRef,
    navigationGuidanceGeometryRef,
    navPlannedMainGeometryRef,
    onPersonalForkRef,
    preferredAreaRouteMapRef,
    setGuidanceGeometryEpoch,
    setReturnTripLeg,
  ]);

  const handleGo = useCallback(() => {
    const chosen = orderedRouteIds[previewLegIndex] ?? orderedRouteIds[0] ?? primaryRouteId;
    if (!chosen) return;
    const route = plan.routes.find((r) => r.id === chosen);
    if (
      shouldPromptTollBeforeGo({
        route,
        tollBypassEnabled,
        acceptedRouteIds: tollAcceptedRouteIdsRef.current,
        chosenRouteId: chosen,
      })
    ) {
      pendingGoAfterTollRef.current = true;
      setTollRoutePrompt({ routeId: chosen, labels: route?.tollLabels ?? [] });
      return;
    }
    proceedGo();
  }, [
    orderedRouteIds,
    previewLegIndex,
    primaryRouteId,
    plan.routes,
    tollBypassEnabled,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    setTollRoutePrompt,
    proceedGo,
  ]);

  const handleStopAndClear = useCallback(() => {
    clearRoute();
    setFitTrigger((n) => n + 1);
  }, [clearRoute, setFitTrigger]);

  return { clearRoute, proceedGo, handleGo, handleStopAndClear };
}
