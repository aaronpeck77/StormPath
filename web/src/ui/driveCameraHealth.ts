import { headingDeltaDegrees } from "../nav/forwardRoutePick";

/** Below this ground speed, GPS course-over-ground is too noisy to trust as "truth". */
export const DRIVE_CAMERA_HEADING_CHECK_MIN_SPEED_MPS = 4; // ~9 mph
/** Camera bearing vs real direction of travel beyond this is a visible "sideways" map.
 *  55° let partially-sideways rejoins pass; ~40° catches what drivers actually notice. */
export const DRIVE_CAMERA_HEADING_MAX_DISAGREE_DEG = 40;
/** Require this many consecutive bad polls before treating it as stuck (ignores one-off GPS blips). */
export const DRIVE_CAMERA_HEADING_STUCK_CONFIRM_TICKS = 2;

export type DriveCameraHealthIssue = "camera_bearing_diverged_from_travel";

/**
 * Independent watchdog for the drive follow-cam: compares the bearing Mapbox actually applied
 * to the map against ground-truth course-over-ground (consecutive GPS fixes), not the same
 * resolver logic that picked the camera bearing in the first place. Catches the "map looks
 * sideways" failure mode regardless of which internal fallback caused it.
 */
export function auditDriveCameraHeading(input: {
  /** Course-over-ground from consecutive GPS fixes — ground truth, independent of the camera. */
  travelBearingDeg: number | null;
  /** Bearing Mapbox actually rendered (reported live from the follow-cam RAF loop). */
  appliedCameraBearingDeg: number | null;
  speedMps: number | null;
}): { ok: boolean; issues: DriveCameraHealthIssue[] } {
  const issues: DriveCameraHealthIssue[] = [];
  if (
    input.travelBearingDeg != null &&
    Number.isFinite(input.travelBearingDeg) &&
    input.appliedCameraBearingDeg != null &&
    Number.isFinite(input.appliedCameraBearingDeg) &&
    input.speedMps != null &&
    input.speedMps >= DRIVE_CAMERA_HEADING_CHECK_MIN_SPEED_MPS
  ) {
    const delta = headingDeltaDegrees(input.travelBearingDeg, input.appliedCameraBearingDeg);
    if (delta > DRIVE_CAMERA_HEADING_MAX_DISAGREE_DEG) {
      issues.push("camera_bearing_diverged_from_travel");
    }
  }
  return { ok: issues.length === 0, issues };
}

export type DriveCameraRepairAction = "resync_camera";

export function repairActionsForDriveCameraIssues(
  issues: readonly DriveCameraHealthIssue[]
): DriveCameraRepairAction[] {
  return issues.length ? ["resync_camera"] : [];
}
