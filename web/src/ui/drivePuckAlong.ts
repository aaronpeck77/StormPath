import { haversineMeters, pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/**
 * Along-route puck: pin to corridor progress, not raw GPS lerp.
 * Must not coast while sitting still at Go — and must not freeze through a corner.
 */

/** Ignore reverse along jumps larger than this while rolling (meters). */
export const ON_ROUTE_REVERSE_IGNORE_M = 8;
/** Blend time-constant toward nav along (seconds). */
export const ON_ROUTE_ALONG_TC_S = 0.28;
/** Below this, treat as parked — do not dead-reckon along the blue line. */
export const ON_ROUTE_PARKED_SPEED_MPS = 1.4;
/** One GPS tick this far is driving, not driveway wobble. */
export const ON_ROUTE_UNPARK_STEP_M = 10;
/** Re-park only when GPS net motion has clearly stopped. */
export const ON_ROUTE_REPARK_SPEED_MPS = 0.7;
/** Window for GPS net displacement → apparent speed. */
export const APPARENT_SPEED_WINDOW_MS = 6_000;

export type GpsSpeedSample = { lng: number; lat: number; t: number };

/**
 * Net displacement / time over the GPS window — not path-length of jitter.
 * Sitting still with 5 m wobble each second is not 5 m/s of driving.
 */
export function netApparentSpeedMps(
  samples: GpsSpeedSample[],
  nowMs: number,
  windowMs: number = APPARENT_SPEED_WINDOW_MS
): number | null {
  const cutoff = nowMs - windowMs;
  let i0 = 0;
  while (i0 < samples.length && samples[i0]!.t < cutoff) i0 += 1;
  if (samples.length - i0 < 2) return null;
  const a = samples[i0]!;
  const b = samples[samples.length - 1]!;
  const span = (b.t - a.t) / 1000;
  if (span < 0.4) return null;
  return haversineMeters([a.lng, a.lat], [b.lng, b.lat]) / span;
}

/** Distance between the two newest GPS samples (one 1 Hz tick). */
export function recentGpsStepMeters(samples: GpsSpeedSample[]): number | null {
  if (samples.length < 2) return null;
  const a = samples[samples.length - 2]!;
  const b = samples[samples.length - 1]!;
  const dt = (b.t - a.t) / 1000;
  if (!(dt > 0) || dt > 2.5) return null;
  return haversineMeters([a.lng, a.lat], [b.lng, b.lat]);
}

/**
 * Parked at Go when leftover iOS speed is high but GPS is still.
 * Not parked through a corner when Core Location speed dips or goes unknown.
 */
export function isParkedForAlongPuck(input: {
  reportedSpeedMps: number | null;
  apparentSpeedMps: number | null;
  recentStepM?: number | null;
  wasRolling?: boolean;
}): boolean {
  const apparent = input.apparentSpeedMps;
  const reported = input.reportedSpeedMps;
  const step = input.recentStepM;
  const gpsMoving =
    (apparent != null && Number.isFinite(apparent) && apparent >= ON_ROUTE_PARKED_SPEED_MPS) ||
    (step != null && Number.isFinite(step) && step >= ON_ROUTE_UNPARK_STEP_M);

  if (gpsMoving) return false;

  if (input.wasRolling) {
    const gpsStill =
      apparent != null && Number.isFinite(apparent) && apparent < ON_ROUTE_REPARK_SPEED_MPS;
    const reportedMoving =
      reported != null && Number.isFinite(reported) && reported >= ON_ROUTE_PARKED_SPEED_MPS;
    if (gpsStill && !reportedMoving) return true;
    /* GPS gap on a turn: keep rolling so the puck does not freeze. */
    return false;
  }

  return true;
}

export function tickOnRoutePuckAlong(input: {
  prevAlongM: number;
  navAlongM: number;
  dtS: number;
  speedMps: number | null;
  routeTotalM: number;
  /** True when GPS/speed says the vehicle is not moving. Explicit false wins over low CL speed. */
  parked?: boolean;
}): number {
  const total = Math.max(0, input.routeTotalM);
  const dt = Math.max(0.008, Math.min(0.12, input.dtS));
  const prev = Math.max(0, Math.min(total, input.prevAlongM));
  let target = Number.isFinite(input.navAlongM)
    ? Math.max(0, Math.min(total, input.navAlongM))
    : prev;
  const speed =
    input.speedMps != null && Number.isFinite(input.speedMps) ? Math.max(0, input.speedMps) : 0;
  const parked = input.parked != null ? Boolean(input.parked) : speed < ON_ROUTE_PARKED_SPEED_MPS;

  if (parked) {
    /* Hold the yard line. Do not blend toward GPS/nav along — that still looks like driving. */
    return prev;
  }

  if (target < prev - ON_ROUTE_REVERSE_IGNORE_M) {
    target = prev;
  }

  const alpha = 1 - Math.exp(-dt / ON_ROUTE_ALONG_TC_S);
  let next = prev + (target - prev) * alpha;
  /* Coast only toward nav along that is already ahead — never invent motion past it. */
  if (target > prev + 1) {
    const coast = prev + Math.max(speed, 0) * dt;
    next = Math.min(target, Math.max(next, coast));
  }

  /* If we froze through a turn, catch up within ~1 s instead of trailing 4–5 s. */
  const behind = target - prev;
  const catchUp = behind > 20 ? Math.max(speed, 16) * dt * 6 : Math.max(speed, 8) * dt * 2.5;
  const cap = Math.max(2.4, catchUp);
  if (next > prev + cap) next = prev + cap;
  if (next < prev - cap) next = prev - cap;
  if (next > target) next = target;
  return Math.max(0, Math.min(total, next));
}

export function lngLatOnRouteAlong(geometry: LngLat[], alongM: number): LngLat {
  return pointAtAlongMeters(geometry, alongM);
}

export function routeTotalMeters(geometry: LngLat[]): number {
  return geometry.length >= 2 ? polylineLengthMeters(geometry) : 0;
}
