/**
 * Drive camera command rules — one owner, written down in one place.
 *
 * DriveMap still paints the map. This file is the contract for *when* and *how
 * hard* the follow-cam may write. Layers of competing writers (Jeff poll,
 * fit/resize, flyTo, parked hold) grew the "camera is messed up in lots of ways"
 * field report. Keep new behavior here first, then call it from DriveMap.
 *
 * What the camera must do:
 *  1. One follow owner while Drive is live (rAF loop). Jeff only nudges that owner.
 *  2. Stay behind the puck; if the puck leaves the yard-line or the canvas, yank
 *     the camera back on *this frame*, not on a seconds-later watchdog.
 *  3. Cruise bearing stays smooth; corners catch up faster than a 1 s glide.
 *  4. Dr/Mp/Rt is one continuous drone shot (mapViewFly): pan/zoom/rotate from
 *     the live camera to the next pose. Never cut or teleport. Follow-cam yields.
 *  5. Diagnostics describe the whole trip, not the last Core reconnect.
 */

import {
  DRIVE_CAMERA_BEARING_MAX_STEP_DEG,
  DRIVE_CAMERA_BEARING_TC_S,
} from "./driveFollowSmooth";
import {
  DRIVE_PUCK_ANCHOR_CHECK_MIN_SPEED_MPS,
  DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX,
} from "./drivePuckHealth";

/** Jeff backup poll. Same-frame reclaim is the primary puck repair. */
export const DRIVE_CAMERA_HEALTH_POLL_MS = 400;
/** Heading-only resync spacing — still ignore one GPS blip. */
export const DRIVE_CAMERA_HEADING_REPAIR_COOLDOWN_MS = 2_500;
/** Soft puck drift: let the rAF reclaim try a couple frames first. */
export const DRIVE_PUCK_SOFT_REPAIR_COOLDOWN_MS = 400;

/** Error vs target (deg) where a corner must stop using the cruise glide. */
export const DRIVE_BEARING_CORNER_ERR_DEG = 14;
/** Error where a sharp turn may take a bigger per-frame step. */
export const DRIVE_BEARING_SHARP_ERR_DEG = 35;

export type DriveBearingCatchUp = {
  tcS: number;
  maxStepDeg: number;
};

/**
 * Straight highway keeps the long glide (no tick). Once the target is already
 * around a corner, shorten the time constant and raise the per-frame cap so
 * the camera rights itself instead of dragging the old heading down the next street.
 */
export function driveBearingCatchUp(errorDeg: number): DriveBearingCatchUp {
  const e = Number.isFinite(errorDeg) ? Math.abs(errorDeg) : 0;
  if (e >= DRIVE_BEARING_SHARP_ERR_DEG) return { tcS: 0.22, maxStepDeg: 18 };
  if (e >= DRIVE_BEARING_CORNER_ERR_DEG) return { tcS: 0.38, maxStepDeg: 12 };
  return { tcS: DRIVE_CAMERA_BEARING_TC_S, maxStepDeg: DRIVE_CAMERA_BEARING_MAX_STEP_DEG };
}

export type DrivePuckReclaimInput = {
  exploring: boolean;
  offCanvas: boolean;
  driftPx: number | null;
  speedMps: number | null;
};

/**
 * Same-frame reclaim: the puck left the screen, or it has climbed far off the
 * yard-line while we are moving. Exploring (pinch/pan) must not fight the driver.
 */
export function shouldReclaimDrivePuckThisFrame(input: DrivePuckReclaimInput): boolean {
  if (input.exploring) return false;
  if (input.offCanvas) return true;
  if (input.driftPx == null || !Number.isFinite(input.driftPx)) return false;
  if (input.driftPx < DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX) return false;
  const sp = input.speedMps;
  return sp != null && Number.isFinite(sp) && sp >= DRIVE_PUCK_ANCHOR_CHECK_MIN_SPEED_MPS;
}

/** Jeff cooldown: severe / off-canvas puck does not wait. Heading still spaces out. */
export function jeffRepairCooldownMs(input: {
  puckReady: boolean;
  puckSevere: boolean;
}): number {
  if (input.puckReady && input.puckSevere) return 0;
  if (input.puckReady) return DRIVE_PUCK_SOFT_REPAIR_COOLDOWN_MS;
  return DRIVE_CAMERA_HEADING_REPAIR_COOLDOWN_MS;
}
