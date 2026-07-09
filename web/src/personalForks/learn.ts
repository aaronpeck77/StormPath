import {
  closestAlongRouteMeters,
  haversineMeters,
  initialBearingDegrees,
  pointAtAlongMeters,
  polylineLengthMeters,
  ROUTE_CORRIDOR_OVERLAP_M,
  slicePolylineBetweenAlong,
} from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { trimPersonalForks } from "./storage";
import type { PersonalFork } from "./types";

/** Lateral distance from planned main before we treat GPS as diverged. */
export const FORK_DIVERGE_CORRIDOR_M = 95;
/** Minimum continuous off-main span to count as a fork (not a brief GPS blip). */
export const FORK_MIN_DIVERGE_M = 900;
/** Shared corridor before the fork must be at least this long. */
export const FORK_MIN_SHARED_PREFIX_M = 1_200;
/** Destinations within this distance can share a fork cluster. */
export const FORK_DEST_MATCH_M = 450;
/** Fork points within this distance merge into the same habit. */
export const FORK_POINT_MATCH_M = 280;
/** Minimum takes before we surface "Your route" in drive. */
export const FORK_MIN_TAKES_TO_OFFER = 2;
/** Sample step along actual path when detecting divergence. */
const DIVERGE_SAMPLE_STEP_M = 120;
/** After leaving the corridor, allow this gap of on-corridor samples before ending the span. */
const DIVERGE_REJOIN_GAP_M = 350;

export type DetectedForkSegment = {
  forkPoint: LngLat;
  forkBearingDeg: number;
  /** Actual path from near the fork to the end of the trip. */
  geometry: LngLat[];
  destCenter: LngLat;
  originCenter: LngLat;
  /** Meters along the planned main where divergence began. */
  divergeAlongMainM: number;
  divergeLengthM: number;
};

function newForkId(): string {
  return `pf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function headingDeltaDegrees(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

type DivergeSpan = { startAlongActual: number; endAlongActual: number };

/**
 * Find the longest continuous off-corridor span on `actual` vs `planned`.
 * Brief blips that rejoin within {@link DIVERGE_REJOIN_GAP_M} are ignored.
 */
function longestDivergeSpan(planned: LngLat[], actual: LngLat[]): DivergeSpan | null {
  const actualLen = polylineLengthMeters(actual);
  const step = Math.max(DIVERGE_SAMPLE_STEP_M, actualLen / 80);

  let spanStart: number | null = null;
  let spanEnd = 0;
  let lastOff = 0;
  let best: DivergeSpan | null = null;

  const flush = () => {
    if (spanStart == null) return;
    const span: DivergeSpan = { startAlongActual: spanStart, endAlongActual: spanEnd };
    if (!best || span.endAlongActual - span.startAlongActual > best.endAlongActual - best.startAlongActual) {
      best = span;
    }
    spanStart = null;
  };

  for (let d = 0; d <= actualLen; d += step) {
    const pt = pointAtAlongMeters(actual, d);
    const { lateralMetersApprox } = closestAlongRouteMeters(pt, planned);
    const off = lateralMetersApprox > FORK_DIVERGE_CORRIDOR_M;
    if (off) {
      if (spanStart == null) spanStart = d;
      spanEnd = d;
      lastOff = d;
    } else if (spanStart != null) {
      if (d - lastOff > DIVERGE_REJOIN_GAP_M) {
        flush();
      } else {
        /* Still inside the rejoin gap — keep the open span. */
        spanEnd = d;
      }
    }
  }
  flush();
  return best;
}

/**
 * Compare a completed drive (actual GPS / nav geometry) against the planned main corridor.
 * Returns a fork segment when the driver left the main route for a sustained detour that still
 * ends near the same destination.
 */
export function detectForkFromActualVsPlanned(
  plannedMain: LngLat[],
  actualPath: LngLat[]
): DetectedForkSegment | null {
  if (plannedMain.length < 2 || actualPath.length < 2) return null;

  const actualLen = polylineLengthMeters(actualPath);
  const plannedLen = polylineLengthMeters(plannedMain);
  if (actualLen < FORK_MIN_SHARED_PREFIX_M + FORK_MIN_DIVERGE_M) return null;
  if (plannedLen < FORK_MIN_SHARED_PREFIX_M) return null;

  const destCenter = actualPath[actualPath.length - 1]!;
  const plannedEnd = plannedMain[plannedMain.length - 1]!;
  if (haversineMeters(destCenter, plannedEnd) > FORK_DEST_MATCH_M * 2.5) {
    /* Detour that ends somewhere else — not a habitual home fork. */
    return null;
  }

  const span = longestDivergeSpan(plannedMain, actualPath);
  if (!span) return null;

  const divergeLengthM = span.endAlongActual - span.startAlongActual;
  if (divergeLengthM < FORK_MIN_DIVERGE_M) return null;
  if (span.startAlongActual < FORK_MIN_SHARED_PREFIX_M) return null;

  /* Prefer the last on-corridor sample just before the span as the fork point. */
  const forkAlongActual = Math.max(0, span.startAlongActual);
  const forkPoint = pointAtAlongMeters(actualPath, forkAlongActual);
  const { alongMeters: divergeAlongMainM, lateralMetersApprox: forkLat } = closestAlongRouteMeters(
    forkPoint,
    plannedMain
  );
  if (forkLat > FORK_DIVERGE_CORRIDOR_M * 1.8) return null;

  const lookAhead = Math.min(actualLen, forkAlongActual + 250);
  const aheadPt = pointAtAlongMeters(actualPath, lookAhead);
  const forkBearingDeg = initialBearingDegrees(forkPoint, aheadPt);

  const forkGeom = slicePolylineBetweenAlong(
    actualPath,
    Math.max(0, forkAlongActual - 40),
    actualLen
  );
  if (forkGeom.length < 2) return null;

  return {
    forkPoint,
    forkBearingDeg,
    geometry: forkGeom,
    destCenter,
    originCenter: actualPath[0]!,
    divergeAlongMainM,
    divergeLengthM,
  };
}

/**
 * Merge a detected fork into the on-device store (cluster by fork point + destination).
 */
export function mergeDetectedFork(
  forks: PersonalFork[],
  detected: DetectedForkSegment,
  nowMs = Date.now()
): PersonalFork[] {
  const idx = forks.findIndex((f) => {
    if (f.dismissed) return false;
    if (haversineMeters(f.forkPoint, detected.forkPoint) > FORK_POINT_MATCH_M) return false;
    if (haversineMeters(f.destCenter, detected.destCenter) > FORK_DEST_MATCH_M) return false;
    return headingDeltaDegrees(f.forkBearingDeg, detected.forkBearingDeg) <= 55;
  });

  if (idx < 0) {
    const next: PersonalFork = {
      id: newForkId(),
      forkPoint: detected.forkPoint,
      forkBearingDeg: detected.forkBearingDeg,
      geometry: detected.geometry,
      destCenter: detected.destCenter,
      originCenter: detected.originCenter,
      takeCount: 1,
      lastTakenMs: nowMs,
      createdAtMs: nowMs,
      typicalEtaDeltaMin: null,
    };
    return trimPersonalForks([...forks, next]);
  }

  const prev = forks[idx]!;
  const useGeom =
    detected.geometry.length >= prev.geometry.length ? detected.geometry : prev.geometry;
  const updated: PersonalFork = {
    ...prev,
    forkPoint: detected.forkPoint,
    forkBearingDeg: detected.forkBearingDeg,
    geometry: useGeom,
    destCenter: detected.destCenter,
    originCenter: detected.originCenter ?? prev.originCenter,
    takeCount: prev.takeCount + 1,
    lastTakenMs: nowMs,
    dismissed: false,
  };
  const copy = [...forks];
  copy[idx] = updated;
  return trimPersonalForks(copy);
}

/** True when two polylines share enough corridor that the "fork" is just noise. */
export function forkLooksLikeMainRoute(forkGeom: LngLat[], mainGeom: LngLat[]): boolean {
  if (forkGeom.length < 2 || mainGeom.length < 2) return true;
  const len = polylineLengthMeters(forkGeom);
  if (len < 200) return true;
  const step = Math.max(200, len / 24);
  let hits = 0;
  let checks = 0;
  for (let d = 0; d <= len; d += step) {
    const pt = pointAtAlongMeters(forkGeom, d);
    checks++;
    const { lateralMetersApprox } = closestAlongRouteMeters(pt, mainGeom);
    if (lateralMetersApprox <= ROUTE_CORRIDOR_OVERLAP_M) hits++;
  }
  return checks > 0 && hits / checks >= 0.72;
}
