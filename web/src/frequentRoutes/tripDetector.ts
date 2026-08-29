import { haversineMeters, polylineLengthMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import type { CompletedLearnedTrip } from "./types";

/** OS / Core Motion style activity (null = unknown — GPS-only heuristics). */
export type TripActivityHint = "automotive" | "cycling" | "on_foot" | "still" | "unknown";

export type TripLearningMachineState = {
  phase: "idle" | "active";
  points: LngLat[];
  startedAt: number;
  lastAppendAt: number;
  lastAppended: LngLat | null;
  slowSince: number | null;
};

const SAMPLE_MS = 16_000;
const MIN_APPEND_M = 28;
const START_SPEED_MPS = 1.2;
/** When Core Motion says automotive/cycling, allow a slightly lower GPS speed to start. */
const START_SPEED_MPS_WITH_MOTION = 0.8;
const END_SLOW_MPS = 0.5;
const END_DWELL_MS = 45_000;
/** Foot / still: end the learned trip sooner so walking after park does not glue on. */
const END_DWELL_MS_NOT_DRIVING = 20_000;
const MIN_TRIP_LEN_M = 300;
const MIN_TRIP_DURATION_MS = 75_000;
const MAX_POINTS = 160;

export function createInitialTripState(now: number): TripLearningMachineState {
  return {
    phase: "idle",
    points: [],
    startedAt: now,
    lastAppendAt: 0,
    lastAppended: null,
    slowSince: null,
  };
}

function simplifyPolyline(pts: LngLat[]): LngLat[] {
  if (pts.length <= MAX_POINTS) return pts;
  const step = Math.ceil(pts.length / MAX_POINTS);
  const out: LngLat[] = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push(pts[i]!);
  }
  const last = pts[pts.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function finishTrip(s: TripLearningMachineState, endedAt: number): CompletedLearnedTrip | null {
  if (s.points.length < 2) return null;
  const distanceM = polylineLengthMeters(s.points);
  const duration = endedAt - s.startedAt;
  if (distanceM < MIN_TRIP_LEN_M || duration < MIN_TRIP_DURATION_MS) return null;
  return {
    geometry: simplifyPolyline(s.points),
    startedAt: s.startedAt,
    endedAt,
    distanceM,
  };
}

function isDrivingLike(hint: TripActivityHint | null | undefined): boolean {
  return hint === "automotive" || hint === "cycling";
}

function isNotDriving(hint: TripActivityHint | null | undefined): boolean {
  return hint === "on_foot" || hint === "still";
}

/**
 * Call on a fixed interval (~4s) with latest fix. Throttles polyline points; ends trip after sustained low speed.
 * Optional {@link TripActivityHint} from Core Motion reduces false starts while walking and helps bridge
 * brief GPS gaps while automotive.
 */
export function processTripSample(
  s: TripLearningMachineState,
  now: number,
  lngLat: LngLat,
  speedMps: number | null,
  activityHint: TripActivityHint | null = null
): { state: TripLearningMachineState; trip: CompletedLearnedTrip | null } {
  if (s.phase === "idle") {
    if (isNotDriving(activityHint)) {
      return { state: s, trip: null };
    }
    const threshold = isDrivingLike(activityHint) ? START_SPEED_MPS_WITH_MOTION : START_SPEED_MPS;
    const moving =
      isDrivingLike(activityHint) && speedMps == null
        ? true
        : speedMps != null && speedMps >= threshold;
    if (!moving) {
      return { state: s, trip: null };
    }
    const next: TripLearningMachineState = {
      phase: "active",
      points: [lngLat],
      startedAt: now,
      lastAppendAt: now,
      lastAppended: lngLat,
      slowSince: null,
    };
    return { state: next, trip: null };
  }

  /* active */
  let slow = speedMps == null || speedMps < END_SLOW_MPS;
  if (isNotDriving(activityHint)) {
    slow = true;
  } else if (isDrivingLike(activityHint) && speedMps == null) {
    /* Motion still says driving but GPS speed dropped — keep the trip alive through a brief dead zone. */
    slow = false;
  }

  let slowSince = s.slowSince;
  if (slow) {
    slowSince = slowSince ?? now;
  } else {
    slowSince = null;
  }

  let points = s.points;
  let lastAppendAt = s.lastAppendAt;
  let lastAppended = s.lastAppended;

  const shouldAppend =
    now - lastAppendAt >= SAMPLE_MS &&
    (lastAppended == null || haversineMeters(lastAppended, lngLat) >= MIN_APPEND_M);
  if (shouldAppend) {
    points = [...points, lngLat];
    lastAppendAt = now;
    lastAppended = lngLat;
  }

  const mid: TripLearningMachineState = {
    phase: "active",
    points,
    startedAt: s.startedAt,
    lastAppendAt,
    lastAppended,
    slowSince,
  };

  const dwellMs = isNotDriving(activityHint) ? END_DWELL_MS_NOT_DRIVING : END_DWELL_MS;
  if (slowSince != null && now - slowSince >= dwellMs) {
    const trip = finishTrip(mid, now);
    return {
      state: createInitialTripState(now),
      trip,
    };
  }

  return { state: mid, trip: null };
}

/** Commit an active trip when navigation ends or the user taps Stop (no 45s idle wait). */
export function forceFinishActiveTrip(
  s: TripLearningMachineState,
  now: number,
  lngLat?: LngLat | null
): { state: TripLearningMachineState; trip: CompletedLearnedTrip | null } {
  if (s.phase !== "active") {
    return { state: s, trip: null };
  }
  let points = s.points;
  if (
    lngLat &&
    (points.length === 0 ||
      s.lastAppended == null ||
      haversineMeters(s.lastAppended, lngLat) >= MIN_APPEND_M)
  ) {
    points = [...points, lngLat];
  }
  const trip = finishTrip({ ...s, points }, now);
  return { state: createInitialTripState(now), trip };
}

/** Record a completed Go navigation leg from the planned route geometry. */
export function completedTripFromGeometry(
  geometry: LngLat[],
  startedAt: number,
  endedAt = Date.now()
): CompletedLearnedTrip | null {
  if (geometry.length < 2) return null;
  const distanceM = polylineLengthMeters(geometry);
  if (distanceM < MIN_TRIP_LEN_M) return null;
  const duration = endedAt - startedAt;
  if (duration < 20_000) return null;
  return {
    geometry: simplifyPolyline(geometry),
    startedAt,
    endedAt,
    distanceM,
  };
}
