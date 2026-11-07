import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  useRouteCompareStore,
  type TollRoutePrompt,
  type TrafficBypassCompareState,
} from "../state/routeCompareStore";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { LngLat, NavRoute } from "./types";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { useTollPreview } from "./useTollPreview";

/**
 * `useTollAvoidFlow` — owns the toll-prompt lifecycle that was scattered across
 * App.tsx: the route-compute prompt effect, the "continue with tolls" handler,
 * and the {@link useTollPreview} kickoff.
 *
 * The busy flag, failure note, and accepted/pending refs stay App-owned because
 * `useComputeRoutes` and `useTripLifecycle` (which run earlier) also touch them —
 * they're passed in and returned unchanged for forwarding.
 */
export function useTollAvoidFlow(deps: {
  tollBypassEnabled: boolean;
  navigationStarted: boolean;
  routing: boolean;
  planRoutes: NavRoute[];
  orderedRouteIds: string[];
  previewLegIndex: number;
  /** True while a traffic-bypass compare panel is open (suppresses the prompt). */
  compareActive: boolean;
  proceedGo: () => void;
  setViewMode: (next: MapViewMode | ((prev: MapViewMode) => MapViewMode)) => void;
  setFitTrigger: Dispatch<SetStateAction<number>>;
  /* Shared toll state owned by App (also consumed by computeRoutes/lifecycle). */
  setTollAvoidBusy: (busy: boolean) => void;
  setTollAvoidFailureNote: Dispatch<SetStateAction<string | null>>;
  tollAcceptedRouteIdsRef: MutableRefObject<Set<string>>;
  pendingGoAfterTollRef: MutableRefObject<boolean>;
  /* useTollPreview deps forwarded from App. */
  userLngLat: LngLat | null;
  mapboxToken: string;
  isPlus: boolean;
  stormAlertsForRouting: NormalizedWeatherAlert[] | undefined;
  stormEnabled: boolean;
  activateRouteCompare: (state: TrafficBypassCompareState) => void;
}): {
  tollRoutePrompt: TollRoutePrompt | null;
  setTollRoutePrompt: ReturnType<typeof useRouteCompareStore.getState>["setTollRoutePrompt"];
  handleTollContinue: () => void;
  handleTollPreview: () => Promise<void>;
} {
  const {
    tollBypassEnabled,
    navigationStarted,
    routing,
    planRoutes,
    orderedRouteIds,
    previewLegIndex,
    compareActive,
    proceedGo,
    setViewMode,
    setFitTrigger,
    setTollAvoidBusy,
    setTollAvoidFailureNote,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    userLngLat,
    mapboxToken,
    isPlus,
    stormAlertsForRouting,
    stormEnabled,
    activateRouteCompare,
  } = deps;

  const tollRoutePrompt = useRouteCompareStore((s) => s.tollRoutePrompt);
  const setTollRoutePrompt = useRouteCompareStore((s) => s.setTollRoutePrompt);

  const handleTollPreview = useTollPreview({
    userLngLat,
    mapboxToken,
    isPlus,
    stormAlertsForRouting,
    stormEnabled,
    pendingGoAfterTollRef,
    setTollAvoidBusy,
    setTollAvoidFailureNote,
    activateRouteCompare,
  });

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
  }, [
    tollRoutePrompt,
    proceedGo,
    setViewMode,
    setTollAvoidFailureNote,
    setTollRoutePrompt,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    setFitTrigger,
  ]);

  useEffect(() => {
    if (!tollBypassEnabled) {
      setTollRoutePrompt(null);
      setTollAvoidFailureNote(null);
      pendingGoAfterTollRef.current = false;
      return;
    }
    if (navigationStarted || routing || planRoutes.length === 0 || compareActive) return;
    const routeId =
      orderedRouteIds[previewLegIndex] ?? orderedRouteIds[0] ?? planRoutes[0]?.id;
    if (!routeId) return;
    const route = planRoutes.find((r) => r.id === routeId);
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
    planRoutes,
    orderedRouteIds,
    previewLegIndex,
    compareActive,
    setTollRoutePrompt,
    setTollAvoidFailureNote,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
  ]);

  return {
    tollRoutePrompt,
    setTollRoutePrompt,
    handleTollContinue,
    handleTollPreview,
  };
}
