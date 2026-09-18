import type { MapViewMode } from "./driveMapTypes";

/**
 * Short "live camera" move between Dr / Mp / Rt.
 * Fast enough to read as one space; long enough to see pitch/zoom change.
 */
export const MAP_VIEW_FLY_MS = 520;

export function shouldAnimateMapViewFly(input: {
  prevViewMode: MapViewMode | null;
  nextViewMode: MapViewMode;
  userExploring?: boolean;
  destPlaceHold?: boolean;
  offRouteCompare?: boolean;
  routeCompare?: boolean;
}): boolean {
  if (input.prevViewMode == null) return false;
  if (input.prevViewMode === input.nextViewMode) return false;
  if (input.destPlaceHold) return false;
  if (input.offRouteCompare || input.routeCompare) return false;
  /* A live pinch/pan owns the camera — jump so we do not fight the gesture. */
  if (input.userExploring) return false;
  return true;
}
