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

/**
 * Geographic delta for the yard-line shift, measured on the *current* transform.
 * Screen points near the center unproject to a delta that depends on zoom, pitch
 * and bearing but not on where the center happens to be, so a follow frame that
 * is already at the Drive pose can pre-shift and write once.
 */
export function yardLineShiftLngLat(input: {
  unproject: (point: [number, number]) => { lng: number; lat: number };
  mapWidth: number;
  mapHeight: number;
  padding: YardLinePadding;
  offset: readonly [number, number];
}): { dLng: number; dLat: number } | null {
  const w = input.mapWidth;
  const h = input.mapHeight;
  if (!(w > 0) || !(h > 0)) return null;
  const anchor = expectedDrivePuckScreenAnchorPx({
    mapWidth: w,
    mapHeight: h,
    padding: input.padding,
    offset: input.offset,
  });
  const mid = { x: w / 2, y: h / 2 };
  const dx = mid.x - anchor.x;
  const dy = mid.y - anchor.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { dLng: 0, dLat: 0 };
  try {
    const from = input.unproject([mid.x, mid.y]);
    const to = input.unproject([mid.x + dx, mid.y + dy]);
    const dLng = to.lng - from.lng;
    const dLat = to.lat - from.lat;
    if (!Number.isFinite(dLng) || !Number.isFinite(dLat)) return null;
    return { dLng, dLat };
  } catch {
    return null;
  }
}

/** Tolerances where the live transform is close enough to reuse for the shift. */
export const YARD_LINE_PRESHIFT_BEARING_TOL_DEG = 1.5;
export const YARD_LINE_PRESHIFT_ZOOM_TOL = 0.02;
export const YARD_LINE_PRESHIFT_PITCH_TOL_DEG = 0.5;

export function canPreShiftYardLineCenter(input: {
  current: { zoom: number; pitch: number; bearing: number } | null;
  target: { zoom: number; pitch: number; bearing: number };
}): boolean {
  const c = input.current;
  if (!c) return false;
  if (!Number.isFinite(c.zoom) || !Number.isFinite(c.pitch) || !Number.isFinite(c.bearing)) {
    return false;
  }
  if (Math.abs(c.zoom - input.target.zoom) > YARD_LINE_PRESHIFT_ZOOM_TOL) return false;
  if (Math.abs(c.pitch - input.target.pitch) > YARD_LINE_PRESHIFT_PITCH_TOL_DEG) return false;
  let dBrg = Math.abs(((c.bearing - input.target.bearing) % 360 + 540) % 360 - 180);
  if (!Number.isFinite(dBrg)) dBrg = 360;
  return dBrg <= YARD_LINE_PRESHIFT_BEARING_TOL_DEG;
}

/**
 * Hard follow that keeps the Drive 30-yard line. Both the rAF loop and Jeff's
 * resync intent land here.
 *
 * Steady state writes **one** pose: the shift is measured on the live transform
 * (already at the Drive zoom/pitch and within a degree of bearing) and folded
 * into the center. Only an entry / post-freeze frame, where the live transform
 * is nowhere near the Drive pose, falls back to write-then-correct.
 */
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
  let w = 0;
  let h = 0;
  try {
    const el = map.getContainer();
    w = el.clientWidth;
    h = el.clientHeight;
  } catch {
    return safeHardFollowCamera(map, opts);
  }

  let live: { zoom: number; pitch: number; bearing: number } | null = null;
  try {
    live = { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  } catch {
    live = null;
  }
  if (canPreShiftYardLineCenter({ current: live, target: opts })) {
    const shift = yardLineShiftLngLat({
      unproject: (pt) => map.unproject(pt),
      mapWidth: w,
      mapHeight: h,
      padding: opts.padding,
      offset: opts.offset,
    });
    if (shift) {
      return safeHardFollowCamera(map, {
        ...opts,
        center: [opts.center[0] + shift.dLng, opts.center[1] + shift.dLat],
      });
    }
  }

  if (!safeHardFollowCamera(map, opts)) return false;
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
