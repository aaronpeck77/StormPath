/** Below this ground speed, brief follow-cam lag is common (lights / crawl) — don't treat as stuck. */
export const DRIVE_PUCK_ANCHOR_CHECK_MIN_SPEED_MPS = 3; // ~7 mph
/** Soft drift from the fixed drive yard-line anchor before Jeff starts counting. */
export const DRIVE_PUCK_ANCHOR_MAX_DRIFT_PX = 56;
/** Large enough that the puck is visibly climbing the route on a frozen map — repair on first poll. */
export const DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX = 110;
/** Soft-drift polls required before treating as stuck (ignores one-frame layout blips). */
export const DRIVE_PUCK_ANCHOR_STUCK_CONFIRM_TICKS = 2;

export type DrivePuckHealthIssue = "puck_drifted_from_anchor";

/**
 * Where the drive follow-cam should pin the puck on screen: center of the padded
 * viewport, then Mapbox `offset` (yard-line placement from {@link driveCameraEaseOptions}).
 */
export function expectedDrivePuckScreenAnchorPx(input: {
  mapWidth: number;
  mapHeight: number;
  padding: { top: number; bottom: number; left: number; right: number };
  offset: readonly [number, number];
}): { x: number; y: number } {
  const { mapWidth: w, mapHeight: h, padding: p, offset } = input;
  return {
    x: p.left + (w - p.left - p.right) / 2 + offset[0],
    y: p.top + (h - p.top - p.bottom) / 2 + offset[1],
  };
}

/**
 * Independent watchdog for "map froze, puck slid up the route": compares the puck's
 * projected screen position to the fixed drive-follow anchor. Repair is the same
 * follow-cam resync that re-centers the map on the puck.
 */
export function auditDrivePuckPlacement(input: {
  /** Pixel distance from puck screen pos → expected yard-line anchor; null = not measuring. */
  driftPx: number | null;
  speedMps: number | null;
}): { ok: boolean; issues: DrivePuckHealthIssue[]; severe: boolean } {
  const issues: DrivePuckHealthIssue[] = [];
  let severe = false;
  if (
    input.driftPx != null &&
    Number.isFinite(input.driftPx) &&
    input.speedMps != null &&
    input.speedMps >= DRIVE_PUCK_ANCHOR_CHECK_MIN_SPEED_MPS
  ) {
    if (input.driftPx >= DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX) {
      issues.push("puck_drifted_from_anchor");
      severe = true;
    } else if (input.driftPx >= DRIVE_PUCK_ANCHOR_MAX_DRIFT_PX) {
      issues.push("puck_drifted_from_anchor");
    }
  }
  return { ok: issues.length === 0, issues, severe };
}

export type DrivePuckRepairAction = "resync_camera";

export function repairActionsForDrivePuckIssues(
  issues: readonly DrivePuckHealthIssue[]
): DrivePuckRepairAction[] {
  return issues.length ? ["resync_camera"] : [];
}
