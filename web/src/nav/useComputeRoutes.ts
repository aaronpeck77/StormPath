import { useCallback, type MutableRefObject } from "react";
import { areaKeyFromLngLat, type PreferredAreaRouteMap } from "../preferredAreaRoutes";
import { pickTrailPreferredRouteId } from "../frequentRoutes/trailRouteOverlap";
import { buildTripFromMapbox } from "../services/mapboxDirectionsRouter";
import { useRouteCompareStore } from "../state/routeCompareStore";
import { useTripPlanStore } from "../state/tripPlanStore";
import { useUiStore } from "../state/uiStore";
import { isAbortError, routeFetchUserMessage } from "../utils/fetchResilient";
import { buildMockTripBetween } from "./emptyTrip";
import {
  computeRoutesFailed,
  computeRoutesSucceeded,
  type ComputeRoutesResult,
  tollAvoidFailureExplanation,
  tollFreeReplanStillHasTolls,
} from "./tollAvoidanceCopy";
import { formatTripDestinationLabel, remainingViaStops } from "./routeWaypoints";
import { slotOrderAfterSelect } from "./routeSlotOrder";
import type { LngLat, TripPlan } from "./types";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";

/**
 * `useComputeRoutes` — Phase 4e5c.
 *
 * Owns the **largest single callback** that used to live in `App.tsx` (~106 lines): the main
 * route-build entry point fired on destination tap, recompute, "use saved place," and toll
 * preview re-plan. Pulled out so:
 *
 *  - The Mapbox call shape, abort-controller dance, epoch-versioning, plus-tier capping,
 *    and preferred-area-route slot promotion all live in one file with focused tests later.
 *  - The auto-recompute and toll-preview kickoffs (the hook in `useTollPreview.ts`) can both
 *    reach for the same fetch primitive without duplicating the storm-aware avoidance plumbing.
 *
 * **Returned function:** identical signature to the prior App-owned `computeRoutes`. Takes
 * the destination `[lng, lat]`, the human label, and an `opts` bag (`preserveNavigation` to
 * skip the planning reset; `excludeToll` to ask Mapbox for a toll-free re-plan).
 *
 * **Stores subscribed:** route-compare (for the toll-prompt clear), trip-plan (for plan,
 * slot order, preview index, dest, view mode), and ui (for collapsing the search bar).
 *
 * **Why a config bag instead of yet more store subscriptions:** the remaining 16 deps are
 * either App-owned `useState` (`setRouting`, `setRouteError`, `setTapHint`,
 * `setTollAvoidFailureNote`, `setFitTrigger`), env values (`mapboxToken`), live data
 * (`userLngLat`, `stormAlertsForRouting`), pay-tier flags (`isPlus`, `payFrequentRoutes`),
 * the App-owned `resetNavigationPlanning` reducer, or imperative refs that exist for
 * race-condition handling (`routeGraphEpochRef`, `routeMainFetchAbortRef`,
 * `tollAcceptedRouteIdsRef`, `pendingGoAfterTollRef`, `preferredAreaRouteMapRef`). Making
 * these into stores would be a much bigger refactor (Phase 4f territory). Until then the
 * config bag is the pragmatic boundary.
 */
export interface UseComputeRoutesDeps {
  userLngLat: LngLat | null;
  mapboxToken: string;
  isPlus: boolean;
  stormAlertsForRouting: NormalizedWeatherAlert[] | undefined;
  stormEnabled: boolean;
  /** Plus-only: prefer learned "preferred route" for the destination's city bucket. */
  payFrequentRoutes: boolean;
  /** Plus + learn where I drive: bias alternates and default preview toward activity trail. */
  learnWhereIDrive: boolean;
  /** Resets nav-only state (turn step, off-route latch, drive timers); skipped on `preserveNavigation`. */
  resetNavigationPlanning: () => void;
  /** Bumped any time the route graph identity changes; lets us discard stale awaits. */
  routeGraphEpochRef: MutableRefObject<number>;
  /** Cancels the prior in-flight Mapbox fetch when a new one starts. */
  routeMainFetchAbortRef: MutableRefObject<AbortController | null>;
  /** Memoizes user-acked toll prompts so the prompt doesn't loop. */
  tollAcceptedRouteIdsRef: MutableRefObject<Set<string>>;
  /** "After the toll prompt resolves, also press Go" flag. */
  pendingGoAfterTollRef: MutableRefObject<boolean>;
  /** Persisted city-bucket → preferred Mapbox role map. */
  preferredAreaRouteMapRef: MutableRefObject<PreferredAreaRouteMap>;
  setRouting: (busy: boolean) => void;
  setRouteError: (msg: string | null) => void;
  setTapHint: (msg: string | null) => void;
  setTollAvoidFailureNote: (note: string | null) => void;
  setFitTrigger: (updater: (prev: number) => number) => void;
}

export type ComputeRoutesFn = (
  end: [number, number],
  label: string,
  opts?: { preserveNavigation?: boolean; excludeToll?: boolean }
) => Promise<ComputeRoutesResult>;

export function useComputeRoutes(deps: UseComputeRoutesDeps): ComputeRoutesFn {
  const {
    userLngLat,
    mapboxToken,
    isPlus,
    stormAlertsForRouting,
    stormEnabled,
    payFrequentRoutes,
    learnWhereIDrive,
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
  } = deps;

  const setTollRoutePrompt = useRouteCompareStore((s) => s.setTollRoutePrompt);
  const setPlan = useTripPlanStore((s) => s.setPlan);
  const setRouteSlotOrder = useTripPlanStore((s) => s.setRouteSlotOrder);
  const setPreviewLegIndex = useTripPlanStore((s) => s.setPreviewLegIndex);
  const setDestLngLat = useTripPlanStore((s) => s.setDestLngLat);
  const setActiveViaIndex = useTripPlanStore((s) => s.setActiveViaIndex);
  const setViewMode = useTripPlanStore((s) => s.setViewMode);
  const setSearchExpanded = useUiStore((s) => s.setSearchExpanded);

  return useCallback(
    async (
      end: [number, number],
      label: string,
      opts?: { preserveNavigation?: boolean; excludeToll?: boolean }
    ): Promise<ComputeRoutesResult> => {
      if (!userLngLat) return computeRoutesFailed("Location is not available yet.");
      const epochAtStart = routeGraphEpochRef.current;
      routeMainFetchAbortRef.current?.abort();
      const mainFetch = new AbortController();
      routeMainFetchAbortRef.current = mainFetch;
      setRouting(true);
      setRouteError(null);
      setTapHint(null);
      const { viaStops, activeViaIndex } = useTripPlanStore.getState();
      const remainingVias = remainingViaStops(viaStops, opts?.preserveNavigation ? activeViaIndex : 0);
      const viaCoords = remainingVias.map((s) => s.lngLat);
      const tripDestLabel = formatTripDestinationLabel(
        opts?.preserveNavigation ? remainingVias : viaStops,
        label
      );

      if (!opts?.preserveNavigation) {
        resetNavigationPlanning();
        setActiveViaIndex(0);
        tollAcceptedRouteIdsRef.current.clear();
        pendingGoAfterTollRef.current = false;
        if (!opts?.excludeToll) {
          setTollRoutePrompt(null);
          setTollAvoidFailureNote(null);
        }
        /* Route planning mode is the immediate next UI step; don't wait on router/post-processing. */
        setViewMode("route");
        setSearchExpanded(false);
      }
      try {
        let p: TripPlan;
        let destForMap: [number, number] = end;
        if (mapboxToken) {
          const built = await buildTripFromMapbox(
            mapboxToken,
            userLngLat,
            end,
            {
              origin: "Your location",
              destination: tripDestLabel,
            },
            {
              signal: mainFetch.signal,
              via: viaCoords.length > 0 ? viaCoords : undefined,
              allowLocalTripThirdRoute: isPlus,
              preferThreeRoutes: isPlus,
              stormAlerts: stormAlertsForRouting,
              radarAvoidanceEnabled: isPlus && stormEnabled,
              excludeToll: Boolean(opts?.excludeToll),
              trailRoutePersonalization: isPlus && learnWhereIDrive,
              skipStormLegRefinement: true,
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
        if (epochAtStart !== routeGraphEpochRef.current) {
          return computeRoutesFailed("Route request was superseded.");
        }
        if (opts?.excludeToll) {
          const primary = p.routes[0];
          if (primary?.hasTolls) {
            return computeRoutesFailed(tollFreeReplanStillHasTolls(primary.tollLabels ?? []));
          }
        }
        setPlan(p);
        let defaultRouteId: string | null = null;
        if (payFrequentRoutes) {
          const prefKey = areaKeyFromLngLat(destForMap);
          const pref = preferredAreaRouteMapRef.current[prefKey];
          const preferredRole = pref?.preferredRole;
          if (preferredRole && p.routes.some((r) => r.role === preferredRole)) {
            defaultRouteId = p.routes.find((r) => r.role === preferredRole)!.id;
          }
        }
        if (!defaultRouteId && learnWhereIDrive) {
          defaultRouteId = pickTrailPreferredRouteId(p.routes);
        }
        if (defaultRouteId) {
          setRouteSlotOrder(slotOrderAfterSelect(p.routes.map((r) => r.id), defaultRouteId));
        } else {
          setRouteSlotOrder(p.routes.map((r) => r.id));
        }
        setPreviewLegIndex(0);
        setDestLngLat(destForMap);
        setViewMode("route");
        setFitTrigger((n) => n + 1);
        setSearchExpanded(false);
        if (opts?.excludeToll) {
          setTollAvoidFailureNote(null);
        }
        return computeRoutesSucceeded();
      } catch (e) {
        if (isAbortError(e)) return computeRoutesFailed("");
        const raw = routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e));
        if (opts?.excludeToll) {
          return computeRoutesFailed(tollAvoidFailureExplanation(raw));
        }
        setRouteError(raw);
        return computeRoutesFailed(raw);
      } finally {
        setRouting(false);
      }
    },
    [
      userLngLat,
      mapboxToken,
      isPlus,
      stormAlertsForRouting,
      stormEnabled,
      payFrequentRoutes,
      learnWhereIDrive,
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
      setTollRoutePrompt,
      setPlan,
      setRouteSlotOrder,
      setPreviewLegIndex,
      setDestLngLat,
      setActiveViaIndex,
      setViewMode,
      setSearchExpanded,
    ]
  );
}
