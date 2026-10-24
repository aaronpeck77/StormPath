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

export type DrivePuckSight = {
  driftPx: number | null;
  offCanvas: boolean;
  /** Value Jeff's ref should hold — severe floor when the puck left the canvas. */
  reportPx: number | null;
};

const OFF_CANVAS_INSET_PX = 8;

/**
 * Project the puck and compare it to the yard-line anchor. Off-canvas is its own
 * failure (blank map, no puck) — do not wait for Jeff's poll to notice.
 */
export function readDrivePuckAnchorDrift(input: {
  project: (lngLat: [number, number]) => { x: number; y: number };
  puck: [number, number] | null;
  mapWidth: number;
  mapHeight: number;
  padding: { top: number; bottom: number; left: number; right: number };
  offset: readonly [number, number];
  exploring: boolean;
}): DrivePuckSight {
  if (input.exploring || !input.puck) {
    return { driftPx: null, offCanvas: false, reportPx: null };
  }
  const w = input.mapWidth;
  const h = input.mapHeight;
  if (!(w > 0) || !(h > 0)) {
    return { driftPx: null, offCanvas: false, reportPx: null };
  }
  let screen: { x: number; y: number };
  try {
    screen = input.project(input.puck);
  } catch {
    return { driftPx: null, offCanvas: false, reportPx: null };
  }
  if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
    return { driftPx: null, offCanvas: false, reportPx: null };
  }
  const anchor = expectedDrivePuckScreenAnchorPx({
    mapWidth: w,
    mapHeight: h,
    padding: input.padding,
    offset: input.offset,
  });
  const driftPx = Math.hypot(screen.x - anchor.x, screen.y - anchor.y);
  const offCanvas =
    screen.x < -OFF_CANVAS_INSET_PX ||
    screen.y < -OFF_CANVAS_INSET_PX ||
    screen.x > w + OFF_CANVAS_INSET_PX ||
    screen.y > h + OFF_CANVAS_INSET_PX;
  const reportPx = offCanvas ? Math.max(driftPx, DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX) : driftPx;
  return { driftPx, offCanvas, reportPx };
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
