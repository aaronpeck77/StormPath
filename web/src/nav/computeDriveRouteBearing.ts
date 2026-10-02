import {
  bearingAlongRouteAhead,
  buildCumulativeDistances,
  closestPointOnPolyline,
  closestPointOnPolylineWindowed,
  haversineMeters,
  initialBearingDegrees,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./routeGeometry";
import type { LngLat } from "./types";

export type ComputeDriveRouteBearingInput = {
  driveOffRouteForwardFraming: boolean;
  driveModeUi: boolean;
  effectiveUserLngLat: LngLat | null | undefined;
  geometry: LngLat[] | null | undefined;
  speedMps: number | null | undefined;
  navigationStarted: boolean;
  userAlongGuidanceM: number;
  /** Meters to the next banner maneuver — stretch look-ahead a little before the turn. */
  metersToManeuver?: number | null;
};

/** Stay on the approach road until the turn is close. 4.5 s / 140 m always-on cut the corner. */
export const DRIVE_ROUTE_LOOKAHEAD_MIN_M = 36;
export const DRIVE_ROUTE_LOOKAHEAD_MAX_M = 110;
export const DRIVE_ROUTE_LOOKAHEAD_SECONDS = 3.2;
/** Peek past the maneuver a little earlier so the chord includes the next street before the car yaws. */
export const DRIVE_ROUTE_STRETCH_SECONDS = 4.4;
export const DRIVE_ROUTE_STRETCH_MIN_M = 80;
export const DRIVE_ROUTE_STRETCH_ADD_SECONDS = 1.8;
export const DRIVE_ROUTE_STRETCH_ADD_MIN_M = 36;
export const DRIVE_ROUTE_STRETCH_CAP_M = 140;

export function driveRouteLookAheadMeters(
  speedMps: number,
  metersToManeuver?: number | null
): number {
  const speed = speedMps > 0 && Number.isFinite(speedMps) ? speedMps : 0;
  let lookAheadM = Math.min(
    DRIVE_ROUTE_LOOKAHEAD_MAX_M,
    Math.max(DRIVE_ROUTE_LOOKAHEAD_MIN_M, DRIVE_ROUTE_LOOKAHEAD_MIN_M + speed * DRIVE_ROUTE_LOOKAHEAD_SECONDS)
  );
  if (
    metersToManeuver != null &&
    Number.isFinite(metersToManeuver) &&
    metersToManeuver >= 0 &&
    metersToManeuver <= Math.max(DRIVE_ROUTE_STRETCH_MIN_M, speed * DRIVE_ROUTE_STRETCH_SECONDS)
  ) {
    lookAheadM = Math.min(
      DRIVE_ROUTE_STRETCH_CAP_M,
      lookAheadM + Math.max(DRIVE_ROUTE_STRETCH_ADD_MIN_M, speed * DRIVE_ROUTE_STRETCH_ADD_SECONDS)
    );
  }
  return lookAheadM;
}

/**
 * How far ahead the drive camera reads the road.
 * About two seconds of travel. A longer chord stays diagonal across the
 * corner until the car has driven that whole distance — at a slow turn
 * that was 10–12 seconds, and the shortcut can point the wrong way.
 * The camera still does not yaw until the corner is inside this window.
 */
export const DRIVE_ALIGN_LOOKAHEAD_MIN_M = 8;
export const DRIVE_ALIGN_LOOKAHEAD_MAX_M = 24;
export const DRIVE_ALIGN_LOOKAHEAD_SECONDS = 2;
/** One-frame reversal. A real turn changes the chord gradually. */
export const DRIVE_ALIGN_SPIKE_DEG = 100;
/** Frames a reversed heading must hold before it is real, not a snap. */
export const DRIVE_ALIGN_SPIKE_HOLD_FRAMES = 3;

export function driveAlignLookAheadMeters(speedMps: number): number {
  const speed = speedMps > 0 && Number.isFinite(speedMps) ? speedMps : 0;
  return Math.min(
    DRIVE_ALIGN_LOOKAHEAD_MAX_M,
    Math.max(DRIVE_ALIGN_LOOKAHEAD_MIN_M, speed * DRIVE_ALIGN_LOOKAHEAD_SECONDS)
  );
}

function signedHeadingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Bearing of the road from `alongM` to `alongM + lookAheadM`. */
export function bearingAheadFromAlongM(
  geometry: LngLat[],
  alongM: number,
  lookAheadM: number,
  cumDist?: Float64Array
): number | null {
  if (geometry.length < 2 || !Number.isFinite(alongM)) return null;
  const la = Math.max(8, lookAheadM);
  const from = pointAtAlongMeters(geometry, alongM, cumDist);
  const to = pointAtAlongMeters(geometry, alongM + la, cumDist);
  if (haversineMeters(from, to) < 2.5) return null;
  return initialBearingDegrees(from, to);
}

/** Closest-point memory for the 60 fps camera. Rebuilt when the polyline changes. */
export type LiveAlignBearingState = {
  geomKey: string;
  cum: Float64Array | null;
  alongM: number | null;
  /** Last heading handed to the camera. A one-frame reversal is ignored. */
  bearingDeg?: number | null;
  pendingBearingDeg?: number | null;
  pendingHits?: number;
};

/**
 * Road heading at the puck, every frame.
 *
 * The React route bearing only moves when the map re-renders, and Core's
 * course is smoothed once a second — that pair is the 6 s crooked line and
 * the one-hertz jumps. The puck is already gliding between those samples,
 * so the camera reads the polyline under it directly.
 */
export function liveDriveAlignBearing(input: {
  state: LiveAlignBearingState;
  geometry: LngLat[] | null | undefined;
  puck: LngLat;
  speedMps: number | null;
  seedAlongM: number | null;
  offRoute: boolean;
}): number | null {
  if (input.offRoute) {
    input.state.bearingDeg = null;
    input.state.pendingBearingDeg = null;
    input.state.pendingHits = 0;
    return null;
  }
  const geometry = input.geometry;
  if (!geometry || geometry.length < 2) return null;
  const g0 = geometry[0]!;
  const key = `${geometry.length}:${g0[0].toFixed(5)},${g0[1].toFixed(5)}`;
  if (key !== input.state.geomKey || !input.state.cum) {
    input.state.geomKey = key;
    input.state.cum = buildCumulativeDistances(geometry);
    input.state.alongM =
      input.seedAlongM != null && Number.isFinite(input.seedAlongM) ? input.seedAlongM : 0;
    input.state.bearingDeg = null;
    input.state.pendingBearingDeg = null;
    input.state.pendingHits = 0;
  }
  const cum = input.state.cum;
  if (!cum) return null;
  const seed =
    input.state.alongM != null && Number.isFinite(input.state.alongM)
      ? input.state.alongM
      : input.seedAlongM != null && Number.isFinite(input.seedAlongM)
        ? input.seedAlongM
        : 0;
  let snap = closestPointOnPolylineWindowed(input.puck, geometry, cum, seed, 120, 200);
  if (snap.lateralMetersApprox > 100) {
    snap = closestPointOnPolyline(input.puck, geometry);
  }
  if (snap.lateralMetersApprox > 100) return null;
  input.state.alongM = snap.alongMeters;
  const speed = input.speedMps != null && Number.isFinite(input.speedMps) ? input.speedMps : 0;
  const raw = bearingAheadFromAlongM(
    geometry,
    snap.alongMeters,
    driveAlignLookAheadMeters(speed),
    cum
  );
  if (raw == null) return null;
  return acceptAlignBearing(input.state, raw);
}

/** Keep the last good heading when one sample reverses. A real turn is gradual. */
function acceptAlignBearing(state: LiveAlignBearingState, next: number): number {
  const prev = state.bearingDeg;
  if (prev == null || !Number.isFinite(prev)) {
    state.bearingDeg = next;
    state.pendingBearingDeg = null;
    state.pendingHits = 0;
    return next;
  }
  if (Math.abs(signedHeadingDelta(prev, next)) <= DRIVE_ALIGN_SPIKE_DEG) {
    state.bearingDeg = next;
    state.pendingBearingDeg = null;
    state.pendingHits = 0;
    return next;
  }
  const pending = state.pendingBearingDeg;
  const same =
    pending != null && Number.isFinite(pending) && Math.abs(signedHeadingDelta(pending, next)) <= 25;
  const hits = (same ? state.pendingHits ?? 0 : 0) + 1;
  state.pendingBearingDeg = next;
  state.pendingHits = hits;
  if (hits >= DRIVE_ALIGN_SPIKE_HOLD_FRAMES) {
    state.bearingDeg = next;
    state.pendingBearingDeg = null;
    state.pendingHits = 0;
    return next;
  }
  return prev;
}

/**
 * Drive camera bearing: polyline ahead on-corridor; falls back to live closest-point
 * tangent when the puck is far from the held progress anchor.
 */
export function computeDriveRouteBearing(input: ComputeDriveRouteBearingInput): number | null {
  const {
    driveOffRouteForwardFraming,
    driveModeUi,
    effectiveUserLngLat,
    geometry,
    speedMps,
    navigationStarted,
    userAlongGuidanceM,
    metersToManeuver = null,
  } = input;

  if (
    driveOffRouteForwardFraming ||
    !driveModeUi ||
    !effectiveUserLngLat ||
    !geometry ||
    geometry.length < 2
  ) {
    return null;
  }

  const speed = speedMps != null && speedMps > 0 ? speedMps : 0;
  const lookAheadM = driveRouteLookAheadMeters(speed, metersToManeuver);

  const OFF_ROUTE_FOR_CAMERA_TANGENT_M = 168;
  const totalM = polylineLengthMeters(geometry);
  let b: number | null = null;

  if (navigationStarted && Number.isFinite(userAlongGuidanceM) && totalM > 1) {
    const fromAlongM = Math.max(0, Math.min(totalM, userAlongGuidanceM));
    const heldAnchor = pointAtAlongMeters(geometry, fromAlongM);
    const distToHeld = haversineMeters(effectiveUserLngLat, heldAnchor);
    if (distToHeld <= OFF_ROUTE_FOR_CAMERA_TANGENT_M) {
      const toAlongM = Math.min(totalM, fromAlongM + lookAheadM);
      const fromPt = pointAtAlongMeters(geometry, fromAlongM);
      const toPt = pointAtAlongMeters(geometry, Math.max(toAlongM, fromAlongM + 0.5));
      if (haversineMeters(fromPt, toPt) >= 2.5) {
        b = initialBearingDegrees(fromPt, toPt);
      }
    }
  }
  if (b == null) {
    b = bearingAlongRouteAhead(effectiveUserLngLat, geometry, lookAheadM);
  }
  return b;
}
