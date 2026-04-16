import { useEffect, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import { haversineMeters } from "../nav/routeGeometry";

const MAX_STEP_M = 200;
const MIN_SPEED_MPS = 0.35;
const CREEP_ALLOW_M = 2.8;

/**
 * Cumulative straight-line distance between GPS fixes while `active` (e.g. navigation on).
 * Used so UI like the progress bar does not “restart” when the route polyline is replaced (reroute).
 */
export function useSessionOdometerMeters(
  pos: LngLat | null,
  active: boolean,
  speedMps: number | null | undefined
): number {
  const [meters, setMeters] = useState(0);
  const prevRef = useRef<LngLat | null>(null);

  useEffect(() => {
    if (!active) {
      prevRef.current = null;
      setMeters(0);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !pos) return;
    const prev = prevRef.current;
    prevRef.current = pos;
    if (!prev) return;

    let d = haversineMeters(prev, pos);
    if (!Number.isFinite(d) || d <= 0) return;
    if (d > MAX_STEP_M) d = MAX_STEP_M;

    if (
      speedMps != null &&
      Number.isFinite(speedMps) &&
      speedMps < MIN_SPEED_MPS &&
      d < CREEP_ALLOW_M
    ) {
      return;
    }

    setMeters((m) => m + d);
  }, [active, pos, speedMps]);

  return meters;
}
