/**
 * Yard-line placement for the hard-write follow-cam path.
 *
 * Mapbox `offset` lives on the animation options, so `easeTo` can hold the puck
 * on the 30-yard line but `setCenter` / `jumpTo` cannot — they center it. When a
 * dead cell latches the hard writer, that difference is what makes the puck climb
 * up the screen, so the hard path has to solve for the offset center itself.
 *
 * The one rule here: **solve in ground space, never in screen pixels.** Drive runs at
 * pitch 68, where pixels and metres are nowhere near proportional.
 */

import type { Map } from "mapbox-gl";
import { expectedDrivePuckScreenAnchorPx } from "./drivePuckHealth";
import { safeHardFollowCamera } from "./mapCameraSafe";
import { haversineMeters } from "../nav/routeGeometry";

export type ScreenPoint = { x: number; y: number };

export type YardLinePadding = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/* Web Mercator, GL JS's own unit square. The ground plane is uniformly scaled here,
 * so a screen point's offset from the center is a constant vector regardless of where
 * the center is — which is what makes the solve below exact. Latitude is not linear
 * in this space, so the arithmetic has to happen here and not in degrees. */
function mercatorX(lng: number): number {
  return (180 + lng) / 360;
}
function mercatorY(lat: number): number {
  return (
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  );
}
function lngFromMercatorX(x: number): number {
  return x * 360 - 180;
}
function latFromMercatorY(y: number): number {
  return (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
}

/**
 * Center that makes `puck` land on the screen point `anchor`.
 *
 * This is the solve `Transform.setLocationAtPoint` performs, and it has to be done
 * this way. The tempting version — reflect the anchor across the center *in screen
 * pixels*, then unproject — is what shipped, and it is wrong under pitch. Screen
 * space is not linear in ground distance at pitch 68: a point 72 px above center is
 * ~3.7 camera-heights out while a point 72 px below is ~1.8, so reflecting pixels
 * overshoots the correction by nearly 2x and throws the puck at the bottom edge.
 * The Jeff resyncs that follow fight the same overshoot, which is why the puck never
 * settled on the yard line.
 *
 * Do it in ground space instead. `anchorGround - center` is the Mercator offset that
 * lands on `anchor`; the puck sits on the anchor exactly when the center is that
 * offset *behind* it.
 *
 * `unproject` is transform math, not rendered data, so it stays valid while tiles are
 * stalled — this works in a dead zone.
 */
export function centerPuttingPuckAtScreenPoint(input: {
  unproject: (point: [number, number]) => { lng: number; lat: number };
  /** The map's current center — the reference `unproject` is measured against. */
  center: [number, number];
  puck: [number, number];
  anchor: ScreenPoint;
}): [number, number] | null {
  if (!Number.isFinite(input.anchor.x) || !Number.isFinite(input.anchor.y)) return null;
  let anchorGround: { lng: number; lat: number };
  try {
    anchorGround = input.unproject([input.anchor.x, input.anchor.y]);
  } catch {
    return null;
  }
  if (!Number.isFinite(anchorGround.lng) || !Number.isFinite(anchorGround.lat)) return null;
  if (Math.abs(anchorGround.lat) > 85) return null;

  const dx = mercatorX(anchorGround.lng) - mercatorX(input.center[0]);
  const dy = mercatorY(anchorGround.lat) - mercatorY(input.center[1]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;

  const nextX = mercatorX(input.puck[0]) - dx;
  const nextY = mercatorY(input.puck[1]) - dy;
  if (!(nextY > 0) || !(nextY < 1)) return null;
  const lng = lngFromMercatorX(nextX);
  const lat = latFromMercatorY(nextY);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/** The Drive yard-line anchor in screen pixels for the current chrome. */
export function driveYardLineAnchorPx(input: {
  mapWidth: number;
  mapHeight: number;
  padding: YardLinePadding;
  offset: readonly [number, number];
}): ScreenPoint | null {
  if (!(input.mapWidth > 0) || !(input.mapHeight > 0)) return null;
  return expectedDrivePuckScreenAnchorPx({
    mapWidth: input.mapWidth,
    mapHeight: input.mapHeight,
    padding: input.padding,
    offset: input.offset,
  });
}

/**
 * How far the yard-line correction may move the camera from the puck. The offset is
 * a fraction of the screen at Drive zoom, so this is generous; it exists only to
 * reject a near-horizon `unproject` blow-up.
 */
export const YARD_LINE_CORRECTION_MAX_M = 1_500;

export function yardLineCorrectionIsSane(
  puck: [number, number],
  corrected: [number, number]
): boolean {
  if (!Number.isFinite(corrected[0]) || !Number.isFinite(corrected[1])) return false;
  /* Latitude past the Mercator limit means the unproject landed off the world. */
  if (Math.abs(corrected[1]) > 85) return false;
  const moved = haversineMeters(puck, corrected);
  if (!Number.isFinite(moved)) return false;
  return moved <= YARD_LINE_CORRECTION_MAX_M;
}

/**
 * Hard follow that keeps the Drive 30-yard line. Both the rAF loop and Jeff's
 * resync intent land here.
 *
 * Write the pose first, then solve for the center that puts the puck on the yard
 * line and write that. The pose has to go in first because the solve depends on the
 * live zoom, pitch and bearing — measuring against the *previous* frame's pose is
 * how you get a correction that was right one frame ago.
 *
 * The pan path gets this for free: `easeTo({ padding, offset })` runs Mapbox's own
 * `setLocationAtPoint`. `setCenter` has no `offset`, so it centers the puck at
 * midfield and we have to reproduce that solve ourselves — see
 * {@link centerPuttingPuckAtScreenPoint} for why it must be ground space, not pixels.
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
  if (!safeHardFollowCamera(map, opts)) return false;
  let anchor: ScreenPoint | null = null;
  try {
    const el = map.getContainer();
    anchor = driveYardLineAnchorPx({
      mapWidth: el.clientWidth,
      mapHeight: el.clientHeight,
      padding: opts.padding,
      offset: opts.offset,
    });
  } catch {
    return true;
  }
  if (!anchor) return true;
  const next = centerPuttingPuckAtScreenPoint({
    unproject: (pt) => map.unproject(pt),
    /* `safeHardFollowCamera` just centered on the puck, so this is the reference
     * the unproject below is measured against. */
    center: opts.center,
    puck: opts.center,
    anchor,
  });
  if (!next) return true;
  /* Drive sits at pitch 68, where a screen point near the horizon unprojects
   * kilometres out. The yard line is a few hundred metres of ground at this zoom, so
   * anything past the sanity radius is a projection artifact — applying it would park
   * the camera on empty map. */
  if (!yardLineCorrectionIsSane(opts.center, next)) return true;
  safeHardFollowCamera(map, {
    center: next,
    zoom: opts.zoom,
    pitch: opts.pitch,
    bearing: opts.bearing,
  });
  return true;
}
