import type { MapViewMode } from "./driveMapTypes";
import {
  TOPDOWN_NAV_MIN_ZOOM,
  TOPDOWN_NAV_STREET_ZOOM,
  coerceTopdownNavStreetZoom,
  resolveTopdownLocalZoom,
} from "./mapTopdownCamera";
import {
  shouldFitFullRouteCorridor,
  shouldFollowPuckTopdown,
  shouldForceTopdownStreetZoomOnEnter,
} from "../nav/viewModeContract";
import type { Map as MapboxMap } from "mapbox-gl";
import type { MutableRefObject } from "react";

/**
 * Navigation camera rules (Mapbox/HERE-style separation):
 * - Dr: street follow + bearing (handled in drive camera module); truncated ahead route line
 * - Mp: puck-centered street zoom — never fit the whole trip while navigating; full overview route line
 * - Rt: full-route bounds fit while navigating; planning uses the same fit path
 *
 * These are thin wrappers over {@link ../nav/viewModeContract} so callers here keep
 * their historical names but the rules live in one place.
 */

export function navigationCameraShouldFitFullRoute(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return shouldFitFullRouteCorridor(viewMode, navigationStarted);
}

export function navigationCameraShouldFollowPuckTopdown(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return shouldFollowPuckTopdown(viewMode, navigationStarted);
}

/** When entering Mp from Rt overview, restore street-level nav zoom. */
export function navigationTopdownZoomForViewChange(
  map: MapboxMap,
  topdownZoomRef: MutableRefObject<number>,
  navigationStarted: boolean,
  enteredTopdown: boolean
): number {
  if (navigationStarted && enteredTopdown) {
    return coerceTopdownNavStreetZoom(map, topdownZoomRef);
  }
  return resolveTopdownLocalZoom(topdownZoomRef, navigationStarted);
}

/**
 * View-switch adapter: given the previous and next view modes, decide whether the
 * next Mp fit must force a street-zoom re-home. Delegates to the view contract so
 * callers can drop `prevViewMode !== "topdown"` checks scattered through DriveMap.
 */
export function navigationTopdownEntryForcesStreetZoom(
  prevViewMode: MapViewMode | null,
  nextViewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return shouldForceTopdownStreetZoomOnEnter(prevViewMode, nextViewMode, navigationStarted);
}

export function navigationTopdownMinZoom(): number {
  return TOPDOWN_NAV_MIN_ZOOM;
}

export function navigationTopdownDefaultZoom(): number {
  return TOPDOWN_NAV_STREET_ZOOM;
}

/** Bust cached snap keys when switching into Rt so overview fit always runs. */
export function navigationRouteOverviewSnapKey(
  viewMode: MapViewMode,
  fitTrigger: number,
  mapResumeTick: number,
  lineFocusId: string,
  routesKey: string
): string {
  return `${viewMode}|${fitTrigger}|${mapResumeTick}|${lineFocusId}|${routesKey}`;
}
