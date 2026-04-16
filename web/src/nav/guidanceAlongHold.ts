import { useRef } from "react";
import { closestAlongRouteMeters } from "./routeGeometry";
import type { LngLat } from "./types";

/**
 * When GPS is far from the route polyline, closest-point projection can jump **ahead** on the line
 * (parallel roads, interchanges). Hold the last trusted along-distance until the fix is back on the corridor.
 */
const LATERAL_TRUST_M = 52;

export function useAlongRouteMetersHeldWhenOffLine(
  pos: LngLat | null,
  geometry: LngLat[] | undefined
): number {
  const holdRef = useRef(0);
  const geomSigRef = useRef("");

  const sig =
    geometry && geometry.length >= 2
      ? `${geometry.length}:${geometry[0]![0].toFixed(5)}:${geometry[geometry.length - 1]![0].toFixed(5)}`
      : "";

  if (sig !== geomSigRef.current) {
    geomSigRef.current = sig;
    holdRef.current = 0;
  }

  if (!geometry?.length || !pos) {
    return 0;
  }

  const { alongMeters, lateralMetersApprox } = closestAlongRouteMeters(pos, geometry);
  if (lateralMetersApprox <= LATERAL_TRUST_M) {
    holdRef.current = alongMeters;
    return alongMeters;
  }
  return holdRef.current;
}
