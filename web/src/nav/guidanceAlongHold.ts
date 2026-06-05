import { useMemo, useRef } from "react";
import {
  buildCumulativeDistances,
  closestAlongRouteMeters,
  closestPointOnPolylineWindowed,
} from "./routeGeometry";
import type { LngLat } from "./types";

/**
 * When GPS is far from the route polyline, closest-point projection can jump **ahead** on the line
 * (parallel roads, interchanges). Hold the last trusted along-distance until the fix is back on the corridor.
 */
/** Max lateral distance (m) from polyline for live along-route progress; matches drive-camera polyline trust. */
export const GUIDANCE_HOLD_LATERAL_MAX_M = 52;
const LATERAL_TRUST_M = GUIDANCE_HOLD_LATERAL_MAX_M;

/**
 * On long routes a full polyline scan can match a segment far ahead (route loops back near the user,
 * parallel highway, interchange). Cap plausible single-update jumps to prevent the position from
 * leaping forward to a wrong segment.
 */
const MAX_FORWARD_JUMP_M = 8_000;   // ~5 mi — more than any realistic GPS jump between updates
const BACK_SEARCH_M       = 600;    // how far behind last hold to look (handles brief reversals / u-turns)
const AHEAD_SEARCH_M      = 3_500;  // how far ahead to search (covers ~60 s at 200 km/h)

export function useAlongRouteMetersHeldWhenOffLine(
  pos: LngLat | null,
  geometry: LngLat[] | undefined,
  /** Bump to clear held progress (trip display health / reroute recovery). */
  resetKey = 0
): number {
  const holdRef    = useRef(0);
  const geomSigRef = useRef("");
  const resetKeyRef = useRef(resetKey);
  const cumDistRef = useRef<Float64Array | null>(null);

  const sig =
    geometry && geometry.length >= 2
      ? `${geometry.length}:${geometry[0]![0].toFixed(5)}:${geometry[geometry.length - 1]![0].toFixed(5)}`
      : "";

  if (resetKey !== resetKeyRef.current) {
    resetKeyRef.current = resetKey;
    holdRef.current = 0;
  }

  if (sig !== geomSigRef.current) {
    geomSigRef.current = sig;
    holdRef.current = 0;
    // Build cumulative distances once per geometry so windowed searches are O(log N + window).
    cumDistRef.current =
      geometry && geometry.length >= 2 ? buildCumulativeDistances(geometry) : null;
  }

  const closest = useMemo(() => {
    if (!geometry?.length || !pos) return null;
    const hold    = holdRef.current;
    const cumDist = cumDistRef.current;
    // After the initial position is set, use a windowed search so we can't match a far-ahead
    // parallel segment — the window physically cannot reach it.
    if (hold > 0 && cumDist) {
      const r = closestPointOnPolylineWindowed(pos, geometry, cumDist, hold, BACK_SEARCH_M, AHEAD_SEARCH_M);
      return { alongMeters: r.alongMeters, lateralMetersApprox: r.lateralMetersApprox };
    }
    // Initial position: full scan (we don't know where on the route we are yet).
    return closestAlongRouteMeters(pos, geometry);
  }, [pos?.[0], pos?.[1], sig]);

  if (!geometry?.length || !pos) {
    return 0;
  }

  if (!closest) {
    return holdRef.current;
  }
  const { alongMeters, lateralMetersApprox } = closest;
  if (lateralMetersApprox <= LATERAL_TRUST_M) {
    // Reject implausibly large forward jumps — protects against a parallel segment far ahead
    // matching better than the segment the user is actually on.
    const jump = alongMeters - holdRef.current;
    if (holdRef.current > 0 && jump > MAX_FORWARD_JUMP_M) {
      return holdRef.current;
    }
    holdRef.current = alongMeters;
    return alongMeters;
  }
  return holdRef.current;
}
