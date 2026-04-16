import { haversineMeters, polylineLengthMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import type { CompletedLearnedTrip } from "./types";

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
const END_SLOW_MPS = 0.5;
const END_DWELL_MS = 95_000;
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

/**
 * Call on a fixed interval (~4s) with latest fix. Throttles polyline points; ends trip after sustained low speed.
 */
export function processTripSample(
  s: TripLearningMachineState,
  now: number,
  lngLat: LngLat,
  speedMps: number | null
): { state: TripLearningMachineState; trip: CompletedLearnedTrip | null } {
  if (s.phase === "idle") {
    const moving = speedMps != null && speedMps >= START_SPEED_MPS;
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
  const slow = speedMps == null || speedMps < END_SLOW_MPS;
  let slowSince = s.slowSince;
  if (slow) {
    slowSince = slowSince ?? now;
  } else {
    slowSince = null;
  }

  let points = s.points;
  let lastAppendAt = s.lastAppendAt;
  let lastAppended = s.lastAppended;

  const shouldAppend = now - lastAppendAt >= SAMPLE_MS && (lastAppended == null || haversineMeters(lastAppended, lngLat) >= MIN_APPEND_M);
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

  if (slowSince != null && now - slowSince >= END_DWELL_MS) {
    const trip = finishTrip(mid, now);
    return {
      state: createInitialTripState(now),
      trip,
    };
  }

  return { state: mid, trip: null };
}
