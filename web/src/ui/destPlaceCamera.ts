import type { LngLat } from "../nav/types";
import { ROUTE_VIEW_PLANNING_STREET_ZOOM, ROUTE_VIEW_REGIONAL_ZOOM } from "./mapTopdownCamera";

/**
 * Dest-tap camera on the StormPath (web) map.
 *
 * Rt regional / “Canada” zoom is ~6.3–7.0. A tap that sets dest used to race home
 * puck-follow, a camera-stop, and then a continent fit — pin looked unplaced and
 * the puck flew off the page. Hold the current street frame until the plan is
 * ready. Only restore zoom when the map is already at that regional scale.
 */

/** Below this is city / state / Canada — dest tap must not land here. */
export const DEST_PLACE_MIN_ZOOM = 11.2;

export function destPlaceHoldZoom(mapZoom: number | null | undefined): number {
  if (mapZoom == null || !Number.isFinite(mapZoom) || mapZoom < DEST_PLACE_MIN_ZOOM) {
    return ROUTE_VIEW_PLANNING_STREET_ZOOM;
  }
  return Math.min(18.5, mapZoom);
}

export function destPlaceNeedsStreetRestore(mapZoom: number | null | undefined): boolean {
  if (mapZoom == null || !Number.isFinite(mapZoom)) return true;
  return mapZoom < DEST_PLACE_MIN_ZOOM;
}

/** Dest is set, routes have not painted yet — hold; do not fit the continent. */
export function shouldHoldDestPlaceFrame(input: {
  destLngLat: LngLat | null | undefined;
  routesLength: number;
  navigationStarted: boolean;
}): boolean {
  return Boolean(input.destLngLat) && input.routesLength === 0 && !input.navigationStarted;
}

/** Regional planning zoom is the Canada fly — dest place must never target it. */
export function destPlaceRejectsRegionalZoom(zoom: number): boolean {
  return zoom <= ROUTE_VIEW_REGIONAL_ZOOM + 0.2;
}
