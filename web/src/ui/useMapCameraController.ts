/**
 * Map camera controller — decision layer for Dr/Mp/Rt view-enter and resume behavior.
 *
 * DriveMap owns the Mapbox instance and executes flyTo/fitBounds. This module owns
 * the *decisions* those calls depend on, sourced from {@link ../nav/viewModeContract}:
 *
 * - Which snap keys must be busted on view enter (so the fit re-runs)?
 * - Must the explore latch be cleared for this transition?
 * - Should Mp force a street-zoom re-home (coming from Rt overview or wide zoom)?
 * - Does a given refit reason override an active explore latch?
 *
 * Extracting these keeps the rules in one testable place and stops DriveMap effects
 * from re-implementing `viewMode === "topdown"` special cases.
 */

import type { MutableRefObject } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { MapViewMode } from "./driveMapTypes";
import {
  programmaticCameraOverridesExploreLatch,
  shouldClearExploreLatchOnViewSwitch,
  shouldFitFullRouteCorridor,
  shouldForceTopdownStreetZoomOnEnter,
} from "../nav/viewModeContract";
import { TOPDOWN_NAV_MIN_ZOOM } from "./mapTopdownCamera";

export type ProgrammaticCameraReason = Parameters<
  typeof programmaticCameraOverridesExploreLatch
>[0];

export type ViewEnterDecision = {
  /** Went from any-other → Rt: refit the full corridor. */
  enteredRouteView: boolean;
  /** Went from any-other → Mp while navigating: street-zoom re-home. */
  enteredTopdownNav: boolean;
  /** Clear the user-explore latch for this transition (view actually changed). */
  clearExploreLatch: boolean;
  /** Bust `navRouteSnapKeyRef` so the Rt overview fit re-executes. */
  bustRouteOverviewSnapKey: boolean;
  /** Bust `topdownSnapKeyRef` so the Mp local fit re-executes. */
  bustTopdownSnapKey: boolean;
  /** Reset planning-fit trigger memo so App-driven refits fire on the new view. */
  resetPlanningFitTrigger: boolean;
};

/**
 * Compute the transition effects for a view-mode change. Callers pass the previous
 * and current view modes; the controller returns which state to reset.
 *
 * This does not touch refs itself — the caller applies the decision so any React
 * timing rules (batched, sync, etc.) remain visible in one place.
 */
export function resolveViewEnterDecision(args: {
  prevViewMode: MapViewMode | null;
  nextViewMode: MapViewMode;
  navigationStarted: boolean;
}): ViewEnterDecision {
  const { prevViewMode, nextViewMode, navigationStarted } = args;
  const viewChanged = prevViewMode !== nextViewMode;
  const clearExploreLatch =
    viewChanged && shouldClearExploreLatchOnViewSwitch(prevViewMode, nextViewMode);

  const enteredRouteView = viewChanged && nextViewMode === "route";
  const enteredTopdownNav =
    viewChanged &&
    nextViewMode === "topdown" &&
    shouldForceTopdownStreetZoomOnEnter(prevViewMode, nextViewMode, navigationStarted);

  return {
    enteredRouteView,
    enteredTopdownNav,
    clearExploreLatch,
    bustRouteOverviewSnapKey: enteredRouteView,
    bustTopdownSnapKey: enteredTopdownNav || (viewChanged && nextViewMode === "topdown"),
    resetPlanningFitTrigger: enteredRouteView,
  };
}

/**
 * Rt overview fit is scheduled on view enter, then a same-tick resize remounts the
 * camera effect. Keep retrying until a fit actually lands — otherwise Rt stays at
 * Mp street zoom.
 */
export function shouldRetryInterruptedRouteOverviewEnter(
  pendingEnter: boolean,
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return pendingEnter && navigationStarted && viewMode === "route";
}

/**
 * Whether an App-driven refit reason (reroute, slot change, style reload, etc.)
 * should override an active explore latch and force the camera to re-fit.
 */
export function refitOverridesExploreLatch(reason: ProgrammaticCameraReason): boolean {
  return programmaticCameraOverridesExploreLatch(reason);
}

/**
 * Rt/planning: whether the current viewMode requires a full-corridor fit right now.
 * Kept here so DriveMap's planning-fit effect can ask a single question.
 */
export function requiresFullRouteFit(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  if (!navigationStarted) return true;
  return shouldFitFullRouteCorridor(viewMode, navigationStarted);
}

/**
 * Mp street-zoom rule: force a re-home when entering Mp fresh, OR when the current
 * map zoom drifted below the nav min zoom (e.g. Rt overview left it at ~6.9).
 *
 * Returns the zoom threshold decision without touching the map — DriveMap decides
 * which helper (`navigationTopdownZoomForViewChange` vs `coerceTopdownNavStreetZoom`)
 * to call based on this flag.
 */
export function topdownFitNeedsStreetZoomReset(args: {
  map: MapboxMap;
  topdownZoomRef: MutableRefObject<number>;
  enteredTopdownNav: boolean;
}): boolean {
  const { map, topdownZoomRef, enteredTopdownNav } = args;
  if (enteredTopdownNav) return true;
  let mapZoom = topdownZoomRef.current;
  try {
    mapZoom = map.getZoom();
  } catch {
    /* map torn down — leave the stored ref value */
  }
  return mapZoom < TOPDOWN_NAV_MIN_ZOOM;
}
