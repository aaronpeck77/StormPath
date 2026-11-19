import { useEffect, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import { haversineMeters } from "../nav/routeGeometry";

const MAX_STEP_M = 200;
const MIN_SPEED_MPS = 0.35;
const CREEP_ALLOW_M = 2.8;

/** Latest odometer reading, mirrored outside React so the trip-cache snapshot can
 *  read it without prop-drilling through App (the cache hook mounts earlier). */
let latestOdometerM = 0;
/** Seed parked by the trip-cache restore — applied once when nav activates. */
let pendingOdometerSeedM: number | null = null;

export function readSessionOdometerMeters(): number {
  return latestOdometerM;
}

/** Mid-drive WebView remount: the cache restore parks the pre-reload total here
 *  so the rail/ETA keep the trip's real progress instead of restarting at 0. */
export function seedSessionOdometerMeters(meters: number): void {
  if (Number.isFinite(meters) && meters > 0) pendingOdometerSeedM = meters;
}

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
  const metersRef = useRef(0);
  const seedAppliedRef = useRef(false);

  const commitMeters = (next: number) => {
    metersRef.current = next;
    latestOdometerM = next;
    setMeters(next);
  };

  useEffect(() => {
    if (!active) {
      prevRef.current = null;
      seedAppliedRef.current = false;
      commitMeters(0);
      return;
    }
    if (!seedAppliedRef.current) {
      seedAppliedRef.current = true;
      const seed = pendingOdometerSeedM;
      pendingOdometerSeedM = null;
      if (seed != null) commitMeters(metersRef.current + seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commitMeters is stable enough; effect keys on `active` only
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

    commitMeters(metersRef.current + d);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commitMeters reads refs only
  }, [active, pos, speedMps]);

  return meters;
}
