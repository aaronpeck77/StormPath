import type { MapViewMode } from "./driveMapTypes";
import {
  TOPDOWN_NAV_MIN_ZOOM,
  TOPDOWN_NAV_STREET_ZOOM,
  coerceTopdownNavStreetZoom,
  resolveTopdownLocalZoom,
} from "./mapTopdownCamera";
import type { Map as MapboxMap } from "mapbox-gl";
import type { MutableRefObject } from "react";

/**
 * Navigation camera rules (Mapbox/HERE-style separation):
 * - Dr: street follow + bearing (handled in drive camera module)
 * - Mp: puck-centered street zoom — never fit the whole trip while navigating
 * - Rt: full-route bounds fit while navigating; planning uses the same fit path
 */

export function navigationCameraShouldFitFullRoute(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return navigationStarted && viewMode === "route";
}

export function navigationCameraShouldFollowPuckTopdown(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return navigationStarted && viewMode === "topdown";
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
