import { useEffect, useRef } from "react";
import {
  closestAlongRouteMeters,
  subsamplePolylineVertexBudget,
} from "./routeGeometry";
import type { LngLat, NavRoute, TripPlan } from "./types";

/**
 * Passed-turn alternate release (Bill, 584).
 *
 * An unselected alternate is only useful until the driver passes the point
 * where it leaves the locked corridor — after that turn there is no going
 * back, so the route is dead weight: it still costs refresh fetches, map
 * layers, and pick-slot attention. Once GPS is clearly past that divergence
 * point (and back on the locked corridor), drop it from the plan. The caller
 * then refreshes alternates so a NEW option can be offered from here.
 */

/** Alternate must sit this far off the locked line to count as diverged. */
const DIVERGE_LATERAL_M = 500;
/** Two consecutive diverged samples — one glitchy vertex is not a turn. */
const DIVERGE_CONFIRM_SAMPLES = 2;
/** Driver must be this far past the divergence point before release. */
const RELEASE_PAST_DIVERGE_M = 400;
/** On-corridor guard — don't measure progress while off-route or on a detour. */
const ON_ROUTE_LATERAL_M = 200;
/** Vertex budgets keep the divergence scan cheap on cross-country legs. */
const DIVERGE_SAMPLE_MAX_VERTS = 400;
const ACTIVE_LITE_MAX_VERTS = 1_000;

/**
 * Along-meters on `active` where `alt` first sustains a real divergence, or
 * null when the alternate never meaningfully leaves the corridor.
 */
export function firstAlternateDivergenceAlongM(
  active: LngLat[],
  alt: LngLat[]
): number | null {
  if (active.length < 2 || alt.length < 2) return null;
  const activeLite =
    active.length > ACTIVE_LITE_MAX_VERTS
      ? subsamplePolylineVertexBudget(active, ACTIVE_LITE_MAX_VERTS)
      : active;
  const altLite =
    alt.length > DIVERGE_SAMPLE_MAX_VERTS
      ? subsamplePolylineVertexBudget(alt, DIVERGE_SAMPLE_MAX_VERTS)
      : alt;
  let streak = 0;
  let streakStartAlong: number | null = null;
  for (const pt of altLite) {
    const c = closestAlongRouteMeters(pt, activeLite);
    if (c.lateralMetersApprox > DIVERGE_LATERAL_M) {
      if (streak === 0) streakStartAlong = c.alongMeters;
      streak += 1;
      if (streak >= DIVERGE_CONFIRM_SAMPLES) return streakStartAlong;
    } else {
      streak = 0;
      streakStartAlong = null;
    }
  }
  return null;
}

export type UseAlternateReleaseOpts = {
  navigationStarted: boolean;
  /** True while the driver is off the locked corridor — never release then. */
  offRouteLatched: boolean;
  userLngLat: LngLat | null;
  plan: TripPlan;
  /** Locked/committed route id — never released. */
  lockedRouteId: string | null;
  setPlan: (updater: (prev: TripPlan) => TripPlan) => void;
  /** Fired after routes are dropped so the caller can fetch fresh alternates. */
  onAlternatesReleased?: () => void;
};

export function useAlternateRelease(opts: UseAlternateReleaseOpts): void {
  const {
    navigationStarted,
    offRouteLatched,
    userLngLat,
    plan,
    lockedRouteId,
    setPlan,
    onAlternatesReleased,
  } = opts;

  /* Divergence along-meters are geometry-derived — cache per route pair so
   * the per-GPS-tick effect stays O(vertices), not O(vertices²). */
  const divergeCacheRef = useRef(new Map<string, number | null>());
  const releasedRef = useRef(false);

  useEffect(() => {
    releasedRef.current = false;
  }, [plan.routes, lockedRouteId]);

  useEffect(() => {
    if (!navigationStarted || offRouteLatched || !userLngLat || !lockedRouteId) {
      return;
    }
    const routes = plan.routes;
    if (routes.length < 2) return;
    const locked = routes.find((r) => r.id === lockedRouteId);
    if (!locked?.geometry?.length) return;

    /* Full geometry for the user projection — one O(n) call per tick is
     * cheap and keeps along-meters honest on long legs. */
    const pos = closestAlongRouteMeters(userLngLat, locked.geometry);
    if (pos.lateralMetersApprox > ON_ROUTE_LATERAL_M) return;

    const cache = divergeCacheRef.current;
    const releaseIds: string[] = [];
    for (const alt of routes) {
      if (alt.id === lockedRouteId || !alt.geometry?.length) continue;
      const key = `${lockedRouteId}>${alt.id}:${alt.geometry.length}:${alt.geometry[0]?.[0] ?? 0}`;
      let divM = cache.get(key);
      if (divM === undefined) {
        divM = firstAlternateDivergenceAlongM(locked.geometry, alt.geometry);
        cache.set(key, divM);
      }
      if (divM != null && pos.alongMeters > divM + RELEASE_PAST_DIVERGE_M) {
        releaseIds.push(alt.id);
      }
    }
    if (!releaseIds.length || releasedRef.current) return;
    releasedRef.current = true;
    const drop = new Set(releaseIds);
    setPlan((prev) => ({
      ...prev,
      routes: prev.routes.filter((r: NavRoute) => !drop.has(r.id)),
    }));
    onAlternatesReleased?.();
  }, [
    navigationStarted,
    offRouteLatched,
    userLngLat,
    plan.routes,
    lockedRouteId,
    setPlan,
    onAlternatesReleased,
  ]);
}
