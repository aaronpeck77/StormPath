import { acceptMapMatchSnap } from "../services/mapboxMapMatching";
import {
  closestAlongRouteMeters,
  closestPointOnPolylineWindowed,
} from "./routeGeometry";
import { buildCumulativeDistances } from "./routeGeometryWorkerClient";
import type { LngLat } from "./types";

/** Lateral trust band for along-route progress (matches drive camera + off-route enter). */
export const NAV_PROGRESS_LATERAL_TRUST_M = 52;
const BACK_SEARCH_M = 600;
const AHEAD_SEARCH_M = 3_500;
const MAX_FORWARD_JUMP_M = 8_000;

/** Event-level alongM (Core / GPS). Caps teleports and ignores reverse chatter while rolling. */
export function stabilizeAlongMeters(input: {
  prevAlongM: number;
  proposedAlongM: number;
  speedMps: number | null;
  dtS: number;
}): number {
  const prev = Number.isFinite(input.prevAlongM) ? input.prevAlongM : 0;
  const proposed = input.proposedAlongM;
  if (!Number.isFinite(proposed)) return prev;
  const dt = Math.max(0.05, Math.min(2.5, input.dtS));
  const speed =
    input.speedMps != null && Number.isFinite(input.speedMps) ? Math.max(0, input.speedMps) : null;
  /* Parked / unknown speed: do not walk alongM down the corridor from GPS wobble. */
  if (speed == null || speed < 1.4) {
    return prev;
  }
  const maxFwd = Math.max(20, speed * dt * 3 + 14);
  const maxBack = speed > 2.2 ? 8 : 28;
  if (proposed > prev + maxFwd) return prev + maxFwd;
  if (proposed < prev - maxBack) return prev;
  return proposed;
}

export type NavigationProgressSource = "map_matched" | "route_snap" | "held";

export type RouteProjection = {
  alongM: number;
  lateralM: number;
};

export function projectOntoRouteNearProgress(
  pos: LngLat,
  geometry: LngLat[],
  alongHintM: number,
  cumDist?: Float64Array | null
): RouteProjection {
  if (geometry.length < 2) {
    const full = closestAlongRouteMeters(pos, geometry);
    return { alongM: full.alongMeters, lateralM: full.lateralMetersApprox };
  }
  const cum =
    cumDist && cumDist.length === geometry.length
      ? cumDist
      : buildCumulativeDistances(geometry);
  if (alongHintM > 0) {
    const windowed = closestPointOnPolylineWindowed(
      pos,
      geometry,
      cum,
      alongHintM,
      BACK_SEARCH_M,
      AHEAD_SEARCH_M
    );
    return {
      alongM: windowed.alongMeters,
      lateralM: windowed.lateralMetersApprox,
    };
  }
  const full = closestAlongRouteMeters(pos, geometry);
  return { alongM: full.alongMeters, lateralM: full.lateralMetersApprox };
}

/**
 * Single pipeline for navigation position + along-route progress.
 * Prefers map-matched road snaps when they stay on the route corridor; otherwise
 * windowed polyline projection; holds progress when GPS leaves the corridor.
 */
export function resolveNavigationProgress(input: {
  rawLngLat: LngLat;
  matchedLngLat?: LngLat | null;
  matchedConfidence?: number | null;
  geometry: LngLat[];
  alongHoldM: number;
  cumDist?: Float64Array | null;
}): {
  positionLngLat: LngLat;
  alongM: number;
  lateralM: number;
  onRoute: boolean;
  source: NavigationProgressSource;
} {
  const { rawLngLat, geometry, alongHoldM, cumDist } = input;
  const rawProj = projectOntoRouteNearProgress(rawLngLat, geometry, alongHoldM, cumDist);

  let matchedProj: RouteProjection | null = null;
  let matchedAccepted = false;
  if (
    input.matchedLngLat &&
    acceptMapMatchSnap(rawLngLat, input.matchedLngLat, input.matchedConfidence ?? null, {
      routeGeometry: geometry,
      maxRouteLateralM: NAV_PROGRESS_LATERAL_TRUST_M + 28,
    })
  ) {
    matchedProj = projectOntoRouteNearProgress(
      input.matchedLngLat,
      geometry,
      alongHoldM,
      cumDist
    );
    matchedAccepted = matchedProj.lateralM <= NAV_PROGRESS_LATERAL_TRUST_M;
  }

  const pickProj = (proj: RouteProjection) => {
    if (alongHoldM > 0) {
      const jump = proj.alongM - alongHoldM;
      if (jump > MAX_FORWARD_JUMP_M) {
        return { alongM: alongHoldM, lateralM: proj.lateralM };
      }
    }
    return proj;
  };

  if (matchedAccepted && matchedProj) {
    const proj = pickProj(matchedProj);
    if (proj.lateralM <= NAV_PROGRESS_LATERAL_TRUST_M) {
      return {
        positionLngLat: input.matchedLngLat!,
        alongM: proj.alongM,
        lateralM: proj.lateralM,
        onRoute: true,
        source: "map_matched",
      };
    }
  }

  if (rawProj.lateralM <= NAV_PROGRESS_LATERAL_TRUST_M) {
    const proj = pickProj(rawProj);
    return {
      positionLngLat: rawLngLat,
      alongM: proj.alongM,
      lateralM: proj.lateralM,
      onRoute: true,
      source: "route_snap",
    };
  }

  return {
    positionLngLat: matchedAccepted && input.matchedLngLat ? input.matchedLngLat : rawLngLat,
    alongM: alongHoldM,
    lateralM: Math.min(rawProj.lateralM, matchedProj?.lateralM ?? rawProj.lateralM),
    onRoute: false,
    source: "held",
  };
}
