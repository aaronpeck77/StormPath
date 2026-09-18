/**
 * Drive follow motion smoothing — puck glide, along-route latch, bearing, zoom.
 *
 * These are the knobs for "how smooth does the map feel while rolling." Keep the
 * changes modest: too long and the camera lags the car around turns; too short
 * and Core's ~1 Hz samples read as ticks.
 *
 * ROLLBACK (pre Sep 17 field polish — restore all together):
 *   puck snapped 0.145, free 0.095, crawling 0.32, stationary 2.4
 *   along-route 0.32
 *   bearing TC 0.7, bearing max step 9
 *   zoom TC 0 (raw Core zoom each sample — felt stepped with speed)
 *   native web write gates: move 0.8 m, bearing 0.45 deg
 */

/** ~1/e time for puck to catch its target while snapped to the corridor. */
export const DRIVE_PUCK_BLEND_SNAPPED_TC_S = 0.22;
/** Off corridor / free GPS glide. */
export const DRIVE_PUCK_BLEND_FREE_TC_S = 0.14;
/** Stop-and-go (0.7–2.0 m/s). */
export const DRIVE_PUCK_BLEND_CRAWLING_TC_S = 0.4;
/** Parked — heavy damping of GPS wobble. */
export const DRIVE_PUCK_BLEND_STATIONARY_TC_S = 2.4;

/** Along-meters latch while snapped — longer = less along-route jitter. */
export const DRIVE_SNAP_ALONG_TC_S = 0.45;

/** Camera bearing toward travel / anticipated route — cruise (straight) only.
 *  Corners use driveBearingCatchUp in driveCameraRules.ts so the map
 *  rights itself instead of dragging the old heading through the turn. */
export const DRIVE_CAMERA_BEARING_TC_S = 1.0;
/** Cap per-frame bearing change on cruise so a bad tangent cannot whip the map. */
export const DRIVE_CAMERA_BEARING_MAX_STEP_DEG = 6.5;

/**
 * Core's speed→zoom curve steps once a second. Blend toward it so the frame
 * breathes instead of ticking when you accelerate onto a freeway.
 */
export const DRIVE_CAMERA_ZOOM_TC_S = 1.35;
export const DRIVE_CAMERA_ZOOM_MAX_STEP = 0.035;

export function drivePuckBlendTcS(input: {
  stationary: boolean;
  crawling: boolean;
  snapped: boolean;
}): number {
  if (input.stationary) return DRIVE_PUCK_BLEND_STATIONARY_TC_S;
  if (input.crawling) return DRIVE_PUCK_BLEND_CRAWLING_TC_S;
  if (input.snapped) return DRIVE_PUCK_BLEND_SNAPPED_TC_S;
  return DRIVE_PUCK_BLEND_FREE_TC_S;
}

/** Exponential approach with a per-step cap — used for Drive zoom. */
export function smoothDriveZoom(
  prev: number | null,
  raw: number,
  alpha: number,
  maxStep: number = DRIVE_CAMERA_ZOOM_MAX_STEP
): number {
  if (prev == null || !Number.isFinite(prev)) return raw;
  if (!Number.isFinite(raw)) return prev;
  let step = (raw - prev) * alpha;
  if (step > maxStep) step = maxStep;
  if (step < -maxStep) step = -maxStep;
  return prev + step;
}
