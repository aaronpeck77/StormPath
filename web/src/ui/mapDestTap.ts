/** Finger dest-pick on the StormPath map — do not wait on Mapbox `click`. */

export const DEST_TAP_MAX_MOVE_PX = 14;
export const DEST_TAP_MAX_DURATION_MS = 500;
export const DEST_TAP_DEBOUNCE_MS = 450;

export type DestTapPoint = { x: number; y: number; t: number };

export function destTapStartFromTouchCount(
  touchCount: number,
  point: { x: number; y: number } | null | undefined,
  nowMs: number
): DestTapPoint | null {
  if (touchCount !== 1 || !point) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y, t: nowMs };
}

export function isDestFingerTap(
  start: DestTapPoint | null,
  end: DestTapPoint,
  remainingTouches: number
): boolean {
  if (!start || remainingTouches > 0) return false;
  if (end.t - start.t > DEST_TAP_MAX_DURATION_MS) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy <= DEST_TAP_MAX_MOVE_PX * DEST_TAP_MAX_MOVE_PX;
}

export function shouldAcceptDestTap(lastAcceptedMs: number, nowMs: number): boolean {
  return nowMs - lastAcceptedMs >= DEST_TAP_DEBOUNCE_MS;
}
