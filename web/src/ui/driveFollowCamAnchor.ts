/**
 * Yard-line placement for the hard-write follow-cam path.
 *
 * Mapbox `offset` lives on the animation options, so `easeTo` can hold the puck
 * on the 30-yard line but `setCenter` / `jumpTo` cannot — they center it. When a
 * dead cell latches the hard writer, that difference is what makes the puck climb
 * up the screen. Shifting the center by the same pixel delta restores the framing.
 */

export type ScreenPoint = { x: number; y: number };

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
