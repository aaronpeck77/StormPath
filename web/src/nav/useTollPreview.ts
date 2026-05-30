import { useCallback, type MutableRefObject } from "react";
import { buildTripFromMapbox } from "../services/mapboxDirectionsRouter";
import {
  type TrafficBypassCompareState,
  setTollCompareContext,
  useRouteCompareStore,
} from "../state/routeCompareStore";
import { useTripPlanStore } from "../state/tripPlanStore";
import { isAbortError, routeFetchUserMessage } from "../utils/fetchResilient";
import { tollAvoidFailureExplanation, tollFreeReplanStillHasTolls } from "./tollAvoidanceCopy";
import { buildTollCompareDisplayPlan } from "./tollRouteCompare";
import type { LngLat } from "./types";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";

/**
 * `useTollPreview` — Phase 4e4 hook extraction of the toll-free reroute kickoff that was
 * previously a 92-line `useCallback` inside `App.tsx`.
 *
 * **What it does:** when the user taps "Preview toll-free route" in the `TollFlowSheets`,
 * this hook
 *  1. re-fetches the Mapbox directions with `excludeToll: true` (using the same Plus
 *     gating + storm avoidance that the main `computeRoutes` does),
 *  2. caps the toll-free plan to 2 routes on Basic tier,
 *  3. snapshots the original plan, slot order, preview leg, view mode, and pending-Go flag
 *     into `routeCompareStore.tollCompareContext` so the compare cancel/confirm handlers can
 *     restore it,
 *  4. swaps the visible plan to a two-leg "with tolls vs toll-free" display via
 *     `buildTollCompareDisplayPlan`,
 *  5. activates the route-compare panel in `compareKind: "toll"` mode via the App-supplied
 *     `activateRouteCompare` helper (which also dismisses overlapping overlays).
 *
 * **Why a hook, not a free function:** it has to subscribe to the trip plan + route compare
 * stores reactively. Pulling them via `useStore.getState()` at call time would freeze the
 * `useCallback` reference whenever the underlying plan changes, which would break the
 * `useEffect`s that depend on `handleTollPreview` for memoization.
 *
 * **What stays in `App.tsx`:** the failure-note + busy flags are still App-owned `useState`
 * (they're shown next to the toll prompt in `TollFlowSheets`), and `activateRouteCompare`
 * lives in App because it reaches into ~12 cross-feature overlay setters that are still
 * `useState` in App.tsx. Phase 4e5 (UI store / `useRouteCompareActions`) will pull those out.
 */
export interface UseTollPreviewDeps {
  /** Current GPS. Hook short-circuits if null. */
  userLngLat: LngLat | null;
  /** Mapbox token; empty string disables the network path (the hook surfaces a copy hint). */
  mapboxToken: string;
  isPlus: boolean;
  /** Storm corridor alerts threaded into Mapbox routing for radar/wx avoidance. */
  stormAlertsForRouting: NormalizedWeatherAlert[] | undefined;
  /** Storm setting — combined with `isPlus` to gate radar avoidance. */
  stormEnabled: boolean;
  /** Imperative ref shared with `handleGo` / `handleTollContinue` — cleared when toll compare opens. */
  pendingGoAfterTollRef: MutableRefObject<boolean>;
  setTollAvoidBusy: (busy: boolean) => void;
  setTollAvoidFailureNote: (note: string | null) => void;
  /** App-owned helper that flips into `topdown` view, fits, and dismisses other overlays. */
  activateRouteCompare: (state: TrafficBypassCompareState) => void;
}

export function useTollPreview(deps: UseTollPreviewDeps): () => Promise<void> {
  const {
    userLngLat,
    mapboxToken,
    isPlus,
    stormAlertsForRouting,
    stormEnabled,
    pendingGoAfterTollRef,
    setTollAvoidBusy,
    setTollAvoidFailureNote,
    activateRouteCompare,
  } = deps;

  const tollRoutePrompt = useRouteCompareStore((s) => s.tollRoutePrompt);
  const plan = useTripPlanStore((s) => s.plan);
  const destLngLat = useTripPlanStore((s) => s.destLngLat);
  const destinationLabel = useTripPlanStore((s) => s.destinationLabel);
  const routeSlotOrder = useTripPlanStore((s) => s.routeSlotOrder);
  const previewLegIndex = useTripPlanStore((s) => s.previewLegIndex);
  const viewMode = useTripPlanStore((s) => s.viewMode);
  const setPlan = useTripPlanStore((s) => s.setPlan);
  const setRouteSlotOrder = useTripPlanStore((s) => s.setRouteSlotOrder);
  const setPreviewLegIndex = useTripPlanStore((s) => s.setPreviewLegIndex);

  return useCallback(async () => {
    if (!isPlus) {
      setTollAvoidFailureNote("Toll-free route preview is a StormPath Plus feature.");
      return;
    }
    if (!destLngLat || !mapboxToken || !userLngLat || !tollRoutePrompt) {
      setTollAvoidFailureNote("Mapbox routing is needed to preview a toll-free route.");
      return;
    }
    const currentRoute = plan.routes.find((r) => r.id === tollRoutePrompt.routeId);
    if (!currentRoute) return;

    setTollAvoidBusy(true);
    setTollAvoidFailureNote(null);
    try {
      const built = await buildTripFromMapbox(
        mapboxToken,
        userLngLat,
        destLngLat,
        {
          origin: "Your location",
          destination: destinationLabel.trim() || "Destination",
        },
        {
          allowLocalTripThirdRoute: isPlus,
          preferThreeRoutes: isPlus,
          stormAlerts: stormAlertsForRouting,
          radarAvoidanceEnabled: isPlus && stormEnabled,
          excludeToll: true,
        }
      );
      let tollFreePlan = built.plan;
      tollFreePlan =
        !isPlus && tollFreePlan.routes.length > 2
          ? { ...tollFreePlan, routes: tollFreePlan.routes.slice(0, 2) }
          : tollFreePlan;
      const tollFreePrimary = tollFreePlan.routes[0];
      if (!tollFreePrimary) {
        setTollAvoidFailureNote(tollAvoidFailureExplanation(undefined));
        return;
      }
      if (tollFreePrimary.hasTolls) {
        setTollAvoidFailureNote(tollFreeReplanStillHasTolls(tollFreePrimary.tollLabels ?? []));
        return;
      }

      const slotOrderSnapshot = routeSlotOrder.length
        ? [...routeSlotOrder]
        : plan.routes.map((r) => r.id);
      setTollCompareContext({
        originalPlan: plan,
        originalRouteId: tollRoutePrompt.routeId,
        originalPreviewLegIndex: previewLegIndex,
        originalSlotOrder: slotOrderSnapshot,
        originalViewMode: viewMode,
        fullTollFreePlan: tollFreePlan,
        pendingGo: pendingGoAfterTollRef.current,
      });

      setPlan(buildTollCompareDisplayPlan(plan, currentRoute, tollFreePrimary));
      setRouteSlotOrder(["r-a", "r-b"]);
      setPreviewLegIndex(0);
      pendingGoAfterTollRef.current = false;

      activateRouteCompare({
        headline: "Compare toll-free alternative on the map",
        etaA: Math.max(1, Math.round(currentRoute.baseEtaMinutes)),
        etaB: Math.max(1, Math.round(tollFreePrimary.baseEtaMinutes)),
        etaC: null,
        hasB: true,
        hasC: false,
        confidence: "high",
        selectedLeg: "r-a",
        hazardLngLat: null,
        hazardAlongMeters: null,
        compareKind: "toll",
      });
    } catch (e) {
      if (isAbortError(e)) return;
      const raw = routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e));
      setTollAvoidFailureNote(tollAvoidFailureExplanation(raw));
    } finally {
      setTollAvoidBusy(false);
    }
  }, [
    destLngLat,
    destinationLabel,
    mapboxToken,
    userLngLat,
    tollRoutePrompt,
    plan,
    routeSlotOrder,
    previewLegIndex,
    viewMode,
    isPlus,
    stormAlertsForRouting,
    stormEnabled,
    pendingGoAfterTollRef,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setTollAvoidBusy,
    setTollAvoidFailureNote,
    activateRouteCompare,
  ]);
}
