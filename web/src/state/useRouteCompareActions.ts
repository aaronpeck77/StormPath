import { useCallback } from "react";
import {
  type TrafficBypassCompareState,
  useRouteCompareStore,
} from "./routeCompareStore";
import { useTripPlanStore } from "./tripPlanStore";
import { setViewModeBeforeTrafficBypass, useUiStore } from "./uiStore";
import { useWeatherStore } from "./weatherStore";

/**
 * Route-compare actions hook — Phase 4e5b.
 *
 * Owns the two helpers that used to live in `App.tsx`:
 *   • `dismissOverlaysForRouteCompare()` — closes every overlay (sheets, drawers, search,
 *     toll prompt, storm bar) so the on-map A/B(/C) compare has a clear map.
 *   • `activateRouteCompare(state)` — runs the dismiss, snapshots the current view mode for
 *     the cancel handler, opens the compare panel, switches to top-down view, and bumps the
 *     fit trigger so the map reframes around both legs.
 *
 * **Why a hook now:** before Phase 4e5a the dismiss helper reached into 11 individual
 * `useState` setters scattered across `App.tsx`. With those moved into `useUiStore` (and
 * the toll-prompt + storm-bar already in their own stores), this hook can subscribe to all
 * four stores directly — no config bag of setters needed. The only App-owned dependency
 * left is `setFitTrigger`, an integer counter that drives map reframe; it's threaded
 * through as a single parameter until Phase 4f optionally moves it into a future
 * map-camera store.
 */
export interface UseRouteCompareActionsDeps {
  /** Increment to ask the map to reframe (App-owned `useState(0)` counter). */
  setFitTrigger: (updater: (prev: number) => number) => void;
}

export interface RouteCompareActions {
  dismissOverlaysForRouteCompare: () => void;
  activateRouteCompare: (state: TrafficBypassCompareState) => void;
}

export function useRouteCompareActions(deps: UseRouteCompareActionsDeps): RouteCompareActions {
  const { setFitTrigger } = deps;

  const dismissAllOverlays = useUiStore((s) => s.dismissAllOverlays);
  const setTollRoutePrompt = useRouteCompareStore((s) => s.setTollRoutePrompt);
  const setTrafficBypassCompare = useRouteCompareStore((s) => s.setTrafficBypassCompare);
  const collapseStormBarTransient = useWeatherStore((s) => s.collapseStormBarTransient);
  const viewMode = useTripPlanStore((s) => s.viewMode);
  const setViewMode = useTripPlanStore((s) => s.setViewMode);

  const dismissOverlaysForRouteCompare = useCallback(() => {
    /* `dismissAllOverlays` collapses 11 setters into one batched UI-store update; the other
     * two reach into their own stores. Same shape as the prior App.tsx body, just without
     * the cross-feature setter import noise. */
    dismissAllOverlays();
    setTollRoutePrompt(null);
    collapseStormBarTransient();
  }, [dismissAllOverlays, setTollRoutePrompt, collapseStormBarTransient]);

  const activateRouteCompare = useCallback(
    (state: TrafficBypassCompareState) => {
      dismissOverlaysForRouteCompare();
      /* Snapshot prior view mode imperatively so the cancel handler can restore it without
       * having to read the (potentially stale) value at unmount time. */
      setViewModeBeforeTrafficBypass(viewMode);
      setTrafficBypassCompare(state);
      setViewMode("topdown");
      setFitTrigger((n) => n + 1);
    },
    [dismissOverlaysForRouteCompare, viewMode, setTrafficBypassCompare, setViewMode, setFitTrigger]
  );

  return { dismissOverlaysForRouteCompare, activateRouteCompare };
}
