import type { Map as MapboxMap } from "mapbox-gl";
import type { MutableRefObject } from "react";

/** Top-down map view: keep the puck at the visual center; map pans to follow GPS. */
export const TOPDOWN_PUCK_OFFSET_PX: [number, number] = [0, 0];
/** Map (Mp) while navigating — street-level on the puck, not Rt whole-route framing. */
export const TOPDOWN_NAV_STREET_ZOOM = 16;
export const TOPDOWN_NAV_MIN_ZOOM = 14.25;

/** Route (Rt): start with regional / state context; user zooms or taps My location for street level. */
export const ROUTE_VIEW_REGIONAL_ZOOM = 6.95;
/** Narrow phones: a bit wider context before “My location” street zoom. */
export const ROUTE_VIEW_REGIONAL_ZOOM_PHONE = 6.35;

/** Planning “My location” / recenter — street-level framing. */
export const ROUTE_VIEW_PLANNING_STREET_ZOOM = 14.2;

export function regionalPlanningZoom(): number {
  if (typeof window === "undefined") return ROUTE_VIEW_REGIONAL_ZOOM;
  return window.matchMedia("(max-width: 520px)").matches
    ? ROUTE_VIEW_REGIONAL_ZOOM_PHONE
    : ROUTE_VIEW_REGIONAL_ZOOM;
}

export function resolveTopdownLocalZoom(
  topdownZoomRef: MutableRefObject<number>,
  navigationStarted: boolean
): number {
  if (navigationStarted) {
    if (topdownZoomRef.current < TOPDOWN_NAV_MIN_ZOOM) {
      topdownZoomRef.current = TOPDOWN_NAV_STREET_ZOOM;
    }
    return topdownZoomRef.current;
  }
  if (topdownZoomRef.current < ROUTE_VIEW_PLANNING_STREET_ZOOM - 0.5) {
    topdownZoomRef.current = ROUTE_VIEW_PLANNING_STREET_ZOOM;
  }
  return topdownZoomRef.current;
}

/** When Mp inherits a wide zoom from Rt overview, snap back to street follow. */
export function coerceTopdownNavStreetZoom(
  map: MapboxMap,
  topdownZoomRef: MutableRefObject<number>
): number {
  let mapZoom = topdownZoomRef.current;
  try {
    mapZoom = map.getZoom();
  } catch {
    /* map torn down */
  }
  const tooWide = mapZoom < TOPDOWN_NAV_STREET_ZOOM - 0.85;
  if (
    mapZoom < TOPDOWN_NAV_MIN_ZOOM ||
    topdownZoomRef.current < TOPDOWN_NAV_MIN_ZOOM ||
    tooWide
  ) {
    topdownZoomRef.current = TOPDOWN_NAV_STREET_ZOOM;
    return TOPDOWN_NAV_STREET_ZOOM;
  }
  topdownZoomRef.current = mapZoom;
  return mapZoom;
}
