/**
 * After a phone-call / page refresh, along-route progress remounts at 0.
 * Walking it forward (stabilize + puck catch-up) traces the whole trip and
 * can overshoot to the destination and end the route.
 */

/** Catch-up / walk only for small gaps (corner freeze). Larger = snap. */
export const RESUME_ALONG_WALK_MAX_M = 250;
/** With an explicit resume tick, snap any gap past driveway noise. */
export const RESUME_ALONG_SNAP_MIN_GAP_M = 80;
/** Last this much of the polyline is "at dest" for false-arrival checks. */
export const RESUME_FALSE_ARRIVAL_TAIL_M = 160;
/** GPS must be at least this far from dest before we reject a tail match. */
export const RESUME_FALSE_ARRIVAL_GPS_M = 220;

export type ResumeAlongSnapInput = {
  prevAlongM: number;
  proposedAlongM: number;
  /** Visibility / page-show asked for a one-shot snap. */
  resumeSnap?: boolean;
  /** No trusted along yet this session (reload, first GPS). */
  unseeded?: boolean;
  routeLengthM?: number;
  /** Haversine from current GPS to destination / route end. */
  gpsToDestM?: number | null;
};

export function isFalseArrivalAlong(input: {
  proposedAlongM: number;
  routeLengthM?: number;
  gpsToDestM?: number | null;
}): boolean {
  const total = input.routeLengthM;
  if (total == null || !Number.isFinite(total) || total < 200) return false;
  const remaining = total - input.proposedAlongM;
  if (remaining > RESUME_FALSE_ARRIVAL_TAIL_M) return false;
  const gps = input.gpsToDestM;
  if (gps == null || !Number.isFinite(gps)) return false;
  return gps > RESUME_FALSE_ARRIVAL_GPS_M;
}

/**
 * Resume / remount: snap to GPS, never walk toward a dest-end match while still far away.
 * Live driving still uses the caller’s stabilize / puck catch-up.
 */
export function nextAlongAfterResume(input: ResumeAlongSnapInput & {
  stabilize: (next: { prevAlongM: number; proposedAlongM: number }) => number;
}): number {
  if (isFalseArrivalAlong(input)) {
    return Number.isFinite(input.prevAlongM) ? input.prevAlongM : 0;
  }
  if (shouldSnapAlongToCurrent(input)) {
    return input.proposedAlongM;
  }
  return input.stabilize({
    prevAlongM: input.prevAlongM,
    proposedAlongM: input.proposedAlongM,
  });
}

/** Jump to GPS along instead of tracing the traveled path. */
export function shouldSnapAlongToCurrent(input: ResumeAlongSnapInput): boolean {
  const prev = Number.isFinite(input.prevAlongM) ? input.prevAlongM : 0;
  const proposed = input.proposedAlongM;
  if (!Number.isFinite(proposed)) return false;
  const gap = proposed - prev;
  if (gap < (input.resumeSnap || input.unseeded ? RESUME_ALONG_SNAP_MIN_GAP_M : RESUME_ALONG_WALK_MAX_M)) {
    return false;
  }
  if (isFalseArrivalAlong(input)) return false;
  if (input.resumeSnap || input.unseeded) return true;
  return gap >= RESUME_ALONG_WALK_MAX_M;
}
