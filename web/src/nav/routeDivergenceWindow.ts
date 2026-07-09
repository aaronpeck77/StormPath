import {
  closestAlongRouteMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
  ROUTE_CORRIDOR_OVERLAP_M,
} from "./routeGeometry";
import type { LngLat } from "./types";

export type RouteDivergenceWindow = {
  /** Meters along `primary` where the routes meaningfully separate. */
  startM: number;
  endM: number;
};

const DEFAULT_SAMPLE_STEP_M = 450;
const DEFAULT_MERGE_GAP_M = 2_500;
const DEFAULT_PAD_M = 14_000;
const MIN_WINDOW_M = 2_000;

/**
 * Where two route polylines leave the same corridor — e.g. toll highway vs surface bypass.
 * Returns the longest merged diverged span on `primary` (typically the with-tolls leg).
 */
export function findRouteDivergenceWindow(
  primary: LngLat[],
  alternate: LngLat[],
  opts?: {
    corridorM?: number;
    sampleStepM?: number;
    mergeGapM?: number;
    padM?: number;
  }
): RouteDivergenceWindow | null {
  if (primary.length < 2 || alternate.length < 2) return null;

  const corridorM = opts?.corridorM ?? ROUTE_CORRIDOR_OVERLAP_M;
  const sampleStepM = opts?.sampleStepM ?? DEFAULT_SAMPLE_STEP_M;
  const mergeGapM = opts?.mergeGapM ?? DEFAULT_MERGE_GAP_M;
  const padM = opts?.padM ?? DEFAULT_PAD_M;

  const totalM = polylineLengthMeters(primary);
  if (totalM < 500) return null;

  const step = Math.max(sampleStepM, totalM / 120);
  const divergedAt: number[] = [];

  for (let d = 0; d <= totalM; d += step) {
    const pt = pointAtAlongMeters(primary, d);
    const { lateralMetersApprox } = closestAlongRouteMeters(pt, alternate);
    if (lateralMetersApprox > corridorM) divergedAt.push(d);
  }

  if (!divergedAt.length) return null;

  const spans: { start: number; end: number }[] = [];
  let spanStart = divergedAt[0]!;
  let spanEnd = divergedAt[0]!;

  for (let i = 1; i < divergedAt.length; i++) {
    const d = divergedAt[i]!;
    if (d - spanEnd <= step + mergeGapM) {
      spanEnd = d;
    } else {
      spans.push({ start: spanStart, end: spanEnd });
      spanStart = d;
      spanEnd = d;
    }
  }
  spans.push({ start: spanStart, end: spanEnd });

  const best = spans.reduce((a, b) =>
    b.end - b.start > a.end - a.start ? b : a
  );

  const startM = Math.max(0, best.start - padM);
  const endM = Math.min(totalM, best.end + padM);
  if (endM - startM < MIN_WINDOW_M) return null;

  return { startM, endM };
}
