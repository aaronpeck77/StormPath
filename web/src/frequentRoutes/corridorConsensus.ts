import {
  buildCumulativeDistances,
  closestAlongRouteMeters,
  haversineMeters,
  pointAtAlongMeters,
} from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/**
 * Consensus picking for learned corridors. A cluster keeps the last few raw
 * trip traces; the offered "Your route" geometry is the medoid — the trace
 * the driver's repeats agree on most — instead of whichever single trip
 * happened to have the most points (one weird drive used to win permanently).
 */

/** Recent per-trip traces retained per cluster (newest last). */
export const MAX_CLUSTER_TRACES = 4;
/** Approx samples taken along each trace when scoring corridor distance. */
const SCORE_SAMPLE_COUNT = 64;
/** Never sample closer than this — short hops still get a handful of checks. */
const SCORE_MIN_STEP_M = 120;

/** Flip `g` when it runs opposite to `reference` (same corridor, either direction). */
function orientLike(reference: LngLat[], g: LngLat[]): LngLat[] {
  if (g.length < 2 || reference.length < 2) return g;
  const last = reference[reference.length - 1]!;
  const forward =
    haversineMeters(g[0]!, reference[0]!) + haversineMeters(g[g.length - 1]!, last);
  const reverse =
    haversineMeters(g[0]!, last) + haversineMeters(g[g.length - 1]!, reference[0]!);
  return forward <= reverse ? g : [...g].reverse();
}

/** Mean distance from samples along `from` to the nearest point on `to`. */
function meanLateralDistanceM(
  from: LngLat[],
  fromCum: Float64Array,
  to: LngLat[]
): number {
  const total = fromCum[fromCum.length - 1] ?? 0;
  const step = Math.max(SCORE_MIN_STEP_M, total / SCORE_SAMPLE_COUNT);
  let sum = 0;
  let n = 0;
  for (let d = 0; d <= total; d += step) {
    const pt = pointAtAlongMeters(from, d, fromCum);
    sum += closestAlongRouteMeters(pt, to).lateralMetersApprox;
    n++;
  }
  return n > 0 ? sum / n : 1e9;
}

/** Symmetric corridor distance — catches traces that diverge OR only cover part of the trip. */
function tracePairDistanceM(
  a: LngLat[],
  aCum: Float64Array,
  b: LngLat[],
  bCum: Float64Array
): number {
  return (meanLateralDistanceM(a, aCum, b) + meanLateralDistanceM(b, bCum, a)) / 2;
}

/**
 * Medoid of the recent traces: lowest total distance to the others.
 * `reference` only sets the canonical direction all candidates are oriented to
 * (the cluster's current geometry), so mixed-direction commutes compare fairly.
 * Ties go to the newest trace — freshness beats a stale incumbent.
 */
export function pickConsensusTrace(
  traces: LngLat[][],
  reference: LngLat[]
): LngLat[] | null {
  const valid = traces.filter((t) => t.length >= 2);
  if (valid.length === 0) return null;
  const oriented = valid.map((t) => orientLike(reference, t));
  if (oriented.length === 1) return oriented[0]!;

  const cums = oriented.map((t) => buildCumulativeDistances(t));
  const scores = new Array<number>(oriented.length).fill(0);
  for (let i = 0; i < oriented.length; i++) {
    for (let j = i + 1; j < oriented.length; j++) {
      const d = tracePairDistanceM(oriented[i]!, cums[i]!, oriented[j]!, cums[j]!);
      scores[i]! += d;
      scores[j]! += d;
    }
  }
  let best = 0;
  for (let i = 1; i < oriented.length; i++) {
    if (scores[i]! <= scores[best]!) best = i;
  }
  return oriented[best]!;
}
