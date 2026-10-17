import type { Map as MapboxMap } from "mapbox-gl";
import type { MutableRefObject } from "react";

/** Top-down map view: keep the puck at the visual center; map pans to follow GPS. */
export const TOPDOWN_PUCK_OFFSET_PX: [number, number] = [0, 0];
/**
 * Map (Mp) while navigating — wide enough for several blocks / upcoming turns
 * without matching Dr’s street-level 3D zoom. Tighter than Rt (whole-route overview).
 */
export const TOPDOWN_NAV_STREET_ZOOM = 12.8;
/** Minimum zoom enforced in topdown nav mode; below this the view snaps back to TOPDOWN_NAV_STREET_ZOOM. */
export const TOPDOWN_NAV_MIN_ZOOM = 11.8;
/**
 * Dr → Mp while navigating. Drive sits near 15.3–16.6. Pull back this far so Mp
 * shows more of the road than the 3D frame. Floor is the Mp street zoom (12.8),
 * still well short of Route overview.
 */
export const TOPDOWN_FROM_DRIVE_ZOOM_OUT = 3.5;

/** Route (Rt): start with regional / state context; user zooms or taps My location for street level. */
export const ROUTE_VIEW_REGIONAL_ZOOM = 6.95;
/** Narrow phones: a bit wider context before “My location” street zoom. */
export const ROUTE_VIEW_REGIONAL_ZOOM_PHONE = 6.35;

/** Planning “My location” / recenter — street-level framing. */
export const ROUTE_VIEW_PLANNING_STREET_ZOOM = 14.2;
/** Planning Mp button — a bit wider than idle-home street zoom so the first flip is not cramped. */
export const TOPDOWN_PLANNING_ZOOM = 13.4;

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
  if (topdownZoomRef.current < TOPDOWN_PLANNING_ZOOM - 0.5) {
    topdownZoomRef.current = TOPDOWN_PLANNING_ZOOM;
  }
  return topdownZoomRef.current;
}

/**
 * When Mp inherits a very wide zoom from Rt overview (or topdownZoomRef was
 * never initialised for navigation), snap back to the default street zoom.
 * The user can freely zoom anywhere above TOPDOWN_NAV_MIN_ZOOM without being
 * snapped back on explore-end.
 */
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
  if (mapZoom < TOPDOWN_NAV_MIN_ZOOM || topdownZoomRef.current < TOPDOWN_NAV_MIN_ZOOM) {
    topdownZoomRef.current = TOPDOWN_NAV_STREET_ZOOM;
    return TOPDOWN_NAV_STREET_ZOOM;
  }
  topdownZoomRef.current = mapZoom;
  return mapZoom;
}

/**
 * Zoom to use the moment Mp is entered while navigating.
 * A wide Rt frame snaps to the street default. A Drive frame pulls back a couple steps.
 * A second call in the same enter (drone + fit) returns the same zoom.
 */
export function topdownZoomOnEnter(
  mapZoom: number,
  topdownZoomRef: MutableRefObject<number>
): number {
  if (!Number.isFinite(mapZoom) || mapZoom < TOPDOWN_NAV_MIN_ZOOM) {
    topdownZoomRef.current = TOPDOWN_NAV_STREET_ZOOM;
    return TOPDOWN_NAV_STREET_ZOOM;
  }
  if (mapZoom <= TOPDOWN_NAV_STREET_ZOOM + 0.45) {
    topdownZoomRef.current = mapZoom;
    return mapZoom;
  }
  const pulled = Math.max(
    TOPDOWN_NAV_STREET_ZOOM,
    mapZoom - TOPDOWN_FROM_DRIVE_ZOOM_OUT
  );
  if (Math.abs(topdownZoomRef.current - pulled) < 0.08) return topdownZoomRef.current;
  topdownZoomRef.current = pulled;
  return pulled;
}
