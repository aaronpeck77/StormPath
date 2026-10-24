import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { isValidLngLatPair } from "./mapCameraSafe";
import { ROUTE_VIEW_PLANNING_STREET_ZOOM, ROUTE_VIEW_REGIONAL_ZOOM } from "./mapTopdownCamera";

/**
 * Dest-tap camera on the StormPath (web) map.
 *
 * Rt regional / “Canada” zoom is ~6.3–7.0. A tap that sets dest used to race home
 * puck-follow, a camera-stop, and then a continent fit — pin looked unplaced and
 * the puck flew off the page. Hold a street frame on the puck (or the pin) until
 * the plan is ready. Never street-zoom the current continent midpoint.
 */

/** Below this is city / state / Canada — dest tap must not land here. */
export const DEST_PLACE_MIN_ZOOM = 11.2;

/**
 * Home used to drop explore 400ms after a pinch. That yanks the camera back to
 * the puck while the user is lining up a building tap — pin never lands, then
 * pinch-out hits continent zoom. Keep the frame they zoomed to.
 */
export const PIN_PLACE_EXPLORE_IDLE_MS = 120_000;

export function exploreIdleMsForPinPlacing(pinPlacing: boolean, fallbackMs: number): number {
  return pinPlacing ? PIN_PLACE_EXPLORE_IDLE_MS : fallbackMs;
}

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

/**
 * Dest is set, routes have not painted yet — hold; do not fit the continent.
 * This is also the only window that gets the pinch-out zoom floor (see
 * mapMinZoomForSession). A dropped pin can be stranded at continent scale; an
 * empty map cannot, and locking that map at city zoom broke weather browsing.
 */
export function shouldHoldDestPlaceFrame(input: {
  destLngLat: LngLat | null | undefined;
  routesLength: number;
  navigationStarted: boolean;
}): boolean {
  return Boolean(input.destLngLat) && input.routesLength === 0 && !input.navigationStarted;
}

/**
 * Home / dest-pick: no trip lines yet, so hold the frame the user zoomed to instead
 * of yanking back to the puck mid-tap. Explore-idle only — do NOT use this for the
 * zoom floor, which must key on a dropped pin (`shouldHoldDestPlaceFrame`).
 */
export function isPlanningPinPlacing(input: {
  routesLength: number;
  navigationStarted: boolean;
}): boolean {
  return input.routesLength === 0 && !input.navigationStarted;
}

/** Regional planning zoom is the Canada fly — dest place must never target it. */
export function destPlaceRejectsRegionalZoom(zoom: number): boolean {
  return zoom <= ROUTE_VIEW_REGIONAL_ZOOM + 0.2;
}

/** Street-zoom of a continent center is the "random field" Bill saw while Mapbox thinks. */
const DEST_PLACE_WAIT_NEAR_M = 8_000;

function firstValidLngLat(
  ...candidates: Array<LngLat | null | undefined>
): LngLat | null {
  for (const c of candidates) {
    if (isValidLngLatPair(c)) return c;
  }
  return null;
}

/**
 * Where the wait camera should sit: puck, dest, or the tap they were already looking at.
 * Never the midpoint of a zoomed-out weather/home frame.
 */
export function destPlaceHoldCenter(input: {
  mapCenter: LngLat | null | undefined;
  userLngLat: LngLat | null | undefined;
  destLngLat: LngLat;
  mapZoom: number | null | undefined;
}): LngLat {
  const dest = input.destLngLat;
  const user = isValidLngLatPair(input.userLngLat) ? input.userLngLat : null;
  if (destPlaceNeedsStreetRestore(input.mapZoom)) {
    return user ?? dest;
  }
  return firstValidLngLat(input.mapCenter, user, dest) ?? dest;
}

/**
 * Same as {@link destPlaceHoldCenter}, but if the street frame is nowhere near
 * the puck or the pin, snap to the puck so a long plan does not sit on a random road.
 */
export function destPlaceWaitCenter(input: {
  mapCenter: LngLat | null | undefined;
  userLngLat: LngLat | null | undefined;
  destLngLat: LngLat;
  mapZoom: number | null | undefined;
}): LngLat {
  const dest = input.destLngLat;
  const user = isValidLngLatPair(input.userLngLat) ? input.userLngLat : null;
  const hold = destPlaceHoldCenter(input);
  if (!user) return hold;
  if (haversineMeters(hold, user) < DEST_PLACE_WAIT_NEAR_M) return hold;
  if (haversineMeters(hold, dest) < DEST_PLACE_WAIT_NEAR_M) return hold;
  return user;
}

export function destPlaceHoldCamera(input: {
  mapCenter: LngLat | null | undefined;
  userLngLat: LngLat | null | undefined;
  destLngLat: LngLat;
  mapZoom: number | null | undefined;
}): { center: LngLat; zoom: number } {
  return {
    center: destPlaceWaitCenter(input),
    zoom: destPlaceHoldZoom(input.mapZoom),
  };
}
