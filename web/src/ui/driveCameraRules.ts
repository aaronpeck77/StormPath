/**
 * Drive camera command rules — one owner, written down in one place.
 *
 * DriveMap still paints the map. This file is the contract for *when* and *how
 * hard* the follow-cam may write. Layers of competing writers (Jeff poll,
 * fit/resize, flyTo, parked hold) grew the "camera is messed up in lots of ways"
 * field report. Keep new behavior here first, then call it from DriveMap.
 *
 * The *when may we write at all* half of this contract now lives in
 * `driveCameraQueue.ts` (`resolveDriveCameraCommand`): one decision, one Mapbox
 * write per frame, priority drone > radio hold > resync > follow. This file keeps
 * the *how hard* tuning (bearing catch-up, reclaim, Jeff cooldowns).
 *
 * What the camera must do:
 *  1. One follow owner while Drive is live (rAF loop). Every other source — Jeff,
 *     the chrome-settle snap, reclaim, hold-clear — publishes an intent and must
 *     never call Mapbox itself.
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
import { easeHeadingDeg } from "./mapDriveCamera";
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
export const DRIVE_BEARING_CORNER_ERR_DEG = 16;
/** Last degrees of a turn. Still faster than cruise, so the road is centered as the car comes out. */
export const DRIVE_BEARING_SETTLE_ERR_DEG = 2.5;
/** Error where a sharp turn may take a slightly quicker step. */
export const DRIVE_BEARING_SHARP_ERR_DEG = 32;

export type DriveBearingCatchUp = {
  tcS: number;
  maxStepDeg: number;
};

/**
 * Line the road up the middle. 200°/s turns a 90° corner in under half a
 * second. The step is capped by the frame time, so it cannot flip in one paint.
 */
export const DRIVE_BEARING_ALIGN_DEG_S = 200;

export function alignDriveBearingDeg(
  prev: number | null,
  target: number,
  dtS: number
): number {
  const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(0.05, dtS) : 0.016;
  return easeHeadingDeg(prev, target, DRIVE_BEARING_ALIGN_DEG_S, dt);
}
/** Last part of the turn. Faster than cruise, slower than the corner sweep. */
export const DRIVE_BEARING_SETTLE_YAW_DEG_S = 48;
export const DRIVE_BEARING_CRUISE_YAW_DEG_S = 14;

/**
 * Straight highway keeps the long glide (no tick). Through a turn the drone
 * sweeps onto the road ahead. The per-frame cap is only a safety stop; the
 * yaw rate is what keeps one Core sample from kicking the map.
 */
export function driveBearingCatchUp(errorDeg: number): DriveBearingCatchUp {
  const e = Number.isFinite(errorDeg) ? Math.abs(errorDeg) : 0;
  if (e >= DRIVE_BEARING_SHARP_ERR_DEG) return { tcS: 0.45, maxStepDeg: 12 };
  if (e >= DRIVE_BEARING_CORNER_ERR_DEG) return { tcS: 0.55, maxStepDeg: 10 };
  if (e >= DRIVE_BEARING_SETTLE_ERR_DEG) return { tcS: 0.32, maxStepDeg: 8 };
  return { tcS: DRIVE_CAMERA_BEARING_TC_S, maxStepDeg: DRIVE_CAMERA_BEARING_MAX_STEP_DEG };
}

/** Degrees the camera may rotate this frame. Scales with dt so a hitch cannot dump the turn. */
export function driveBearingFrameStepDeg(errorDeg: number, dtS: number): number {
  const catchUp = driveBearingCatchUp(errorDeg);
  const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(0.12, dtS) : 0.016;
  const e = Math.abs(errorDeg);
  const rate =
    e >= DRIVE_BEARING_CORNER_ERR_DEG
      ? DRIVE_BEARING_ALIGN_DEG_S
      : e >= DRIVE_BEARING_SETTLE_ERR_DEG
        ? DRIVE_BEARING_SETTLE_YAW_DEG_S
        : DRIVE_BEARING_CRUISE_YAW_DEG_S;
  return Math.min(catchUp.maxStepDeg, Math.max(0.12, rate * dt));
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
