/**
 * Yard-line placement for the hard-write follow-cam path.
 *
 * Mapbox `offset` lives on the animation options, so `easeTo` can hold the puck
 * on the 30-yard line but `setCenter` / `jumpTo` cannot — they center it. When a
 * dead cell latches the hard writer, that difference is what makes the puck climb
 * up the screen. Shifting the center by the same pixel delta restores the framing.
 */

import type { Map } from "mapbox-gl";
import { expectedDrivePuckScreenAnchorPx } from "./drivePuckHealth";
import { safeHardFollowCamera } from "./mapCameraSafe";

export type ScreenPoint = { x: number; y: number };

export type YardLinePadding = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/**
 * Center that puts `puck` on `anchor`. Screen-space math, so it needs the map's
 * current projection — pass `map.project` / `map.unproject` (both stay valid while
 * tiles are stalled, since they are transform math, not rendered data).
 */
export function centerForPuckScreenAnchor(input: {
  project: (lngLat: [number, number]) => ScreenPoint;
  unproject: (point: [number, number]) => { lng: number; lat: number };
  center: [number, number];
  puck: [number, number];
  anchor: ScreenPoint;
  /** Ignore sub-pixel corrections so a parked puck cannot jitter the center. */
  minShiftPx?: number;
}): [number, number] | null {
  const minShift = input.minShiftPx ?? 0.5;
  let puckPt: ScreenPoint;
  let centerPt: ScreenPoint;
  try {
    puckPt = input.project(input.puck);
    centerPt = input.project(input.center);
  } catch {
    return null;
  }
  if (
    !Number.isFinite(puckPt.x) ||
    !Number.isFinite(puckPt.y) ||
    !Number.isFinite(centerPt.x) ||
    !Number.isFinite(centerPt.y)
  ) {
    return null;
  }

  const dx = puckPt.x - input.anchor.x;
  const dy = puckPt.y - input.anchor.y;
  if (Math.abs(dx) < minShift && Math.abs(dy) < minShift) return input.center;

  try {
    const next = input.unproject([centerPt.x + dx, centerPt.y + dy]);
    if (!Number.isFinite(next.lng) || !Number.isFinite(next.lat)) return null;
    return [next.lng, next.lat];
  } catch {
    return null;
  }
}

/**
 * After `setCenter(puck)` the puck sits at canvas mid (50-yard). This is the
 * center that drops it back to the 30-yard anchor. Uses canvas mid when
 * `project` is stale — Jeff's 435 path centered 515 times and never shifted.
 */
export function yardLineCenterAfterHardFollow(input: {
  unproject: (point: [number, number]) => { lng: number; lat: number };
  mapWidth: number;
  mapHeight: number;
  padding: YardLinePadding;
  offset: readonly [number, number];
  centerScreen?: ScreenPoint;
}): [number, number] | null {
  const w = input.mapWidth;
  const h = input.mapHeight;
  if (!(w > 0) || !(h > 0)) return null;
  const anchor = expectedDrivePuckScreenAnchorPx({
    mapWidth: w,
    mapHeight: h,
    padding: input.padding,
    offset: input.offset,
  });
  const mid = input.centerScreen ?? { x: w / 2, y: h / 2 };
  if (!Number.isFinite(mid.x) || !Number.isFinite(mid.y)) return null;
  const dx = mid.x - anchor.x;
  const dy = mid.y - anchor.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  try {
    const next = input.unproject([mid.x + dx, mid.y + dy]);
    if (!Number.isFinite(next.lng) || !Number.isFinite(next.lat)) return null;
    return [next.lng, next.lat];
  } catch {
    return null;
  }
}

/** Hard follow that keeps the Drive 30-yard line. Both the rAF loop and Jeff must use this. */
export function writeHardFollowToYardLine(
  map: Map,
  opts: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
    padding: YardLinePadding;
    offset: readonly [number, number];
  }
): boolean {
  if (!safeHardFollowCamera(map, opts)) return false;
  let w = 0;
  let h = 0;
  try {
    const el = map.getContainer();
    w = el.clientWidth;
    h = el.clientHeight;
  } catch {
    return true;
  }
  let centerScreen: ScreenPoint | undefined;
  try {
    const p = map.project(opts.center);
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) centerScreen = p;
  } catch {
    centerScreen = undefined;
  }
  const next = yardLineCenterAfterHardFollow({
    unproject: (pt) => map.unproject(pt),
    mapWidth: w,
    mapHeight: h,
    padding: opts.padding,
    offset: opts.offset,
    centerScreen,
  });
  if (!next) return true;
  safeHardFollowCamera(map, {
    center: next,
    zoom: opts.zoom,
    pitch: opts.pitch,
    bearing: opts.bearing,
  });
  return true;
}
