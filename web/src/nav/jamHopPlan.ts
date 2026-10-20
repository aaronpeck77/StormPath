import { METERS_PER_MILE } from "./constants";
import { pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import type { LngLat } from "./types";

/**
 * A jam is a stretch on the locked line.
 * The tail is where traffic first goes bad. Clear is where that highway is moving again.
 * This does not use the old pin window or the motorway ban.
 */
const MIN_LEAVE_M = 0.4 * METERS_PER_MILE;
const LEAVE_SECONDS = 45;
const REJOIN_PAST_CLEAR_M = 0.3 * METERS_PER_MILE;
/** Jam still ahead of an exit, past this, is worth leaving. Shorter than this, keep creeping. */
const REMAINING_WORTH_M = 2 * METERS_PER_MILE;
/** An exit this close, and still ahead, is the one the driver can take now. */
const TAKE_WINDOW_M = 0.5 * METERS_PER_MILE;
const EXIT_REACH_M = 100;
/** Keep avoid points on the dead mainline, off the ramps at either end. */
const INSET_M = 150;
const SAMPLE_M = 0.5 * METERS_PER_MILE;
const MAX_EXCLUDE_POINTS = 50;

export type JamHopPlan =
  | { ok: false; reason: "bad-stretch" | "no-time" | "no-rejoin" | "no-exit" | "stay-in-queue" }
  | {
      ok: true;
      /** True when the car is already in the queue and the hop is the next exit ahead. */
      fromQueue: boolean;
      /** False while that exit is still too far to take. The car keeps creeping toward it. */
      canTakeNow: boolean;
      /** Be off the highway by here. */
      leaveByMeters: number;
      /** The highway is the route again after here. */
      rejoinMeters: number;
      excludePoints: LngLat[];
    };

export function planJamHop(opts: {
  line: LngLat[];
  userAlongMeters: number;
  tailMeters: number;
  clearMeters: number;
  speedMps: number | null;
  /** Interchange positions along the locked line. Used once the car is already in the queue. */
  exitsMeters?: number[];
}): JamHopPlan {
  const { userAlongMeters, tailMeters, clearMeters } = opts;
  if (!Number.isFinite(tailMeters) || !Number.isFinite(clearMeters) || clearMeters <= tailMeters) {
    return { ok: false, reason: "bad-stretch" };
  }

  const totalMeters = polylineLengthMeters(opts.line);
  const rejoinMeters = clearMeters + REJOIN_PAST_CLEAR_M;
  if (rejoinMeters > totalMeters) return { ok: false, reason: "no-rejoin" };

  if (userAlongMeters >= tailMeters) {
    return hopFromQueue(opts, rejoinMeters);
  }

  const speed = opts.speedMps && opts.speedMps > 0 ? opts.speedMps : 27;
  const needed = Math.max(MIN_LEAVE_M, speed * LEAVE_SECONDS);
  if (tailMeters - userAlongMeters < needed) return { ok: false, reason: "no-time" };

  const excludePoints = pointsOnSpan(opts.line, tailMeters + INSET_M, clearMeters - INSET_M, tailMeters, clearMeters);
  if (excludePoints.length === 0) return { ok: false, reason: "bad-stretch" };

  return {
    ok: true,
    fromQueue: false,
    canTakeNow: true,
    leaveByMeters: tailMeters - needed,
    rejoinMeters,
    excludePoints,
  };
}

function hopFromQueue(
  opts: {
    line: LngLat[];
    userAlongMeters: number;
    clearMeters: number;
    exitsMeters?: number[];
  },
  rejoinMeters: number
): JamHopPlan {
  const nextExit = (opts.exitsMeters ?? [])
    .filter((exit) => Number.isFinite(exit) && exit > opts.userAlongMeters + EXIT_REACH_M)
    .sort((a, b) => a - b)
    .find((exit) => exit < opts.clearMeters);
  if (nextExit == null) return { ok: false, reason: "no-exit" };
  if (opts.clearMeters - nextExit < REMAINING_WORTH_M) return { ok: false, reason: "stay-in-queue" };

  const excludePoints = pointsOnSpan(
    opts.line,
    nextExit + INSET_M,
    opts.clearMeters - INSET_M,
    nextExit,
    opts.clearMeters
  );
  if (excludePoints.length === 0) return { ok: false, reason: "stay-in-queue" };

  return {
    ok: true,
    fromQueue: true,
    canTakeNow: nextExit - opts.userAlongMeters <= TAKE_WINDOW_M,
    leaveByMeters: nextExit,
    rejoinMeters,
    excludePoints,
  };
}

/** Mapbox Directions `exclude` value. Each point snaps to the nearest road and that road is left out. */
export function mapboxExcludePointsParam(points: LngLat[]): string {
  return points
    .slice(0, MAX_EXCLUDE_POINTS)
    .map((point) => `point(${point[0].toFixed(5)} ${point[1].toFixed(5)})`)
    .join(",");
}

function pointsOnSpan(
  line: LngLat[],
  fromMeters: number,
  toMeters: number,
  midA: number,
  midB: number
): LngLat[] {
  if (toMeters - fromMeters < 80) {
    const mid = (midA + midB) / 2;
    if (mid <= midA || mid >= midB) return [];
    return [pointAtAlongMeters(line, mid)];
  }
  const points: LngLat[] = [];
  for (let along = fromMeters; along <= toMeters + 1 && points.length < MAX_EXCLUDE_POINTS; along += SAMPLE_M) {
    points.push(pointAtAlongMeters(line, along));
  }
  return points;
}
