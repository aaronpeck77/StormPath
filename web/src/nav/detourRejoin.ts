import { METERS_PER_MILE } from "./constants";
import {
  measureOffRouteLateral,
  OFF_ROUTE_REROUTE_EXIT_M,
} from "./offRouteDetect";
import { haversineMeters, initialBearingDegrees, polylineLengthMeters } from "./routeGeometry";
import {
  departBearingFromRoute,
  headingDeltaDegrees,
  routeStartsWithUturn,
} from "./forwardRoutePick";
import type { LngLat, NavRoute } from "./types";

const MI = METERS_PER_MILE;

/** Shuffle targets for local rejoin — miles ahead on the locked leg. */
export const REJOIN_OFFSETS_MI = [1.2, 2.2, 3.2, 4.5, 5.5] as const;
/**
 * Missed-turn / beside-corridor rejoin — still ahead of the leave point.
 * Keep the closest target ≥ ~0.7 mi so Mapbox does not U-turn to a nearby behind point.
 */
export const REJOIN_OFFSETS_NEAR_MI = [0.7, 1.1, 1.6, 2.2, 3.0] as const;

/** Depart more opposite than this vs travel heading → reverse stub (hard reject). */
export const REJOIN_REVERSE_DEPART_DELTA_DEG = 100;

export type PickRejoinAlongOpts = {
  speedMps?: number;
  lateralM?: number;
};

/**
 * Aim for a rejoin point ahead on the locked route — not the destination.
 * Speed and lateral offset push the target further ahead on fast / wide departures.
 */
export function pickLocalRejoinAlongM(
  userAlongM: number,
  totalM: number,
  shufflePass = 0,
  opts?: PickRejoinAlongOpts
): number {
  if (!Number.isFinite(totalM) || totalM <= 0) return 0;
  const along = Math.max(0, userAlongM);
  const lateralM = opts?.lateralM ?? 0;
  const nearMissedTurn = lateralM > 0 && lateralM <= 90;
  const offsetList = nearMissedTurn ? REJOIN_OFFSETS_NEAR_MI : REJOIN_OFFSETS_MI;
  const offsetMi = offsetList[shufflePass % offsetList.length]!;
  let offsetM = offsetMi * MI;

  const speedMps = opts?.speedMps ?? 0;
  const mph = speedMps * 2.23694;
  if (mph > 45) {
    offsetM += (mph - 45) * 30;
  } else if (mph > 25) {
    offsetM += (mph - 25) * 15;
  }

  if (lateralM > 25) {
    offsetM += Math.min(4000, (lateralM - 25) * 40);
  }

  const minAhead = Math.min(0.85 * MI, Math.max(500, totalM * 0.02));
  const target = along + Math.max(minAhead, offsetM);
  return Math.min(Math.max(0, totalM - 25), target);
}

/**
 * True when the stub leaves reverse of travel (labeled U-turn or depart delta).
 * Soft scoring used to accept these and paint a line behind the puck — hard-reject instead.
 */
export function isReverseRejoinRoute(
  route: NavRoute,
  userLngLat: LngLat,
  headingDeg?: number | null
): boolean {
  if (route.geometry.length < 2) return true;
  if (routeStartsWithUturn(route)) return true;
  const depart = departBearingFromRoute(userLngLat, route.geometry);
  if (depart == null) return false;

  /* Even without GPS heading: leaving opposite the stub's own end is a U-turn loop. */
  const end = route.geometry[route.geometry.length - 1]!;
  const towardEnd = initialBearingDegrees(userLngLat, end);
  if (
    Number.isFinite(towardEnd) &&
    headingDeltaDegrees(towardEnd, depart) > REJOIN_REVERSE_DEPART_DELTA_DEG
  ) {
    return true;
  }

  if (headingDeg == null || !Number.isFinite(headingDeg)) return false;
  return headingDeltaDegrees(headingDeg, depart) > REJOIN_REVERSE_DEPART_DELTA_DEG;
}

/** Prefer live progress over a stale leave latch so rejoin targets stay ahead of the puck. */
export function resolveRejoinAlongBasisM(opts: {
  latchedLeaveAlongM: number;
  liveAlongOnLockedM: number;
  guidanceAlongM?: number;
}): number {
  return Math.max(
    0,
    opts.latchedLeaveAlongM || 0,
    opts.liveAlongOnLockedM || 0,
    opts.guidanceAlongM || 0
  );
}

export function filterForwardRejoinRoutes(
  routes: NavRoute[],
  userLngLat: LngLat,
  headingDeg?: number | null
): NavRoute[] {
  return routes.filter((r) => !isReverseRejoinRoute(r, userLngLat, headingDeg));
}

/** Prefer the shortest-time forward detour that does not wander excessively. */
export function pickBestRejoinRoute(
  routes: NavRoute[],
  userLngLat: LngLat,
  rejoinPt: LngLat,
  headingDeg?: number | null
): NavRoute | null {
  const forward = filterForwardRejoinRoutes(routes, userLngLat, headingDeg);
  if (!forward.length) return null;
  if (forward.length === 1) return forward[0]!;

  const straightM = Math.max(haversineMeters(userLngLat, rejoinPt), 80);
  const scored = forward.map((r, index) => {
    const lenM = polylineLengthMeters(r.geometry);
    const etaMin = r.baseEtaMinutes ?? 99;
    const detourRatio = lenM / straightM;
    let score = etaMin * 2 + detourRatio * 6 + lenM / 1200 + index * 0.05;
    if (
      headingDeg != null &&
      Number.isFinite(headingDeg) &&
      r.geometry.length >= 2
    ) {
      const departBearing = initialBearingDegrees(userLngLat, r.geometry[1]!);
      const delta = headingDeltaDegrees(headingDeg, departBearing);
      score += delta * 0.08;
    }
    return { r, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0]!.r;
}

/** Order B/C so the best forward detour is first — empty if only reverse stubs remain. */
export function orderRejoinRoutesBestFirst(
  routes: NavRoute[],
  userLngLat: LngLat,
  rejoinPt: LngLat,
  headingDeg?: number | null
): NavRoute[] {
  const forward = filterForwardRejoinRoutes(routes, userLngLat, headingDeg);
  if (!forward.length) return [];
  if (forward.length === 1) return forward;
  const best = pickBestRejoinRoute(forward, userLngLat, rejoinPt, headingDeg);
  if (!best) return [];
  const rest = forward.filter((r) => r.id !== best.id);
  return [best, ...rest];
}

/** True when the driver is back on the locked route near the planned rejoin point. */
export function hasRejoinedLockedRoute(
  user: LngLat,
  lockedGeometry: LngLat[],
  rejoinAlongM: number,
  alongHintM?: number
): boolean {
  if (lockedGeometry.length < 2 || !(rejoinAlongM > 0)) return false;
  const hint = alongHintM ?? rejoinAlongM * 0.85;
  const sample = measureOffRouteLateral(user, lockedGeometry, hint);
  const rejoinToleranceM = Math.max(450, rejoinAlongM * 0.07);
  return (
    sample.lateralM < OFF_ROUTE_REROUTE_EXIT_M &&
    sample.alongM >= rejoinAlongM - rejoinToleranceM
  );
}

export function metersRemainingToRejoinOnLockedRoute(
  lockedGeometry: LngLat[],
  rejoinAlongM: number,
  userLngLat: LngLat,
  alongHintM: number
): number {
  if (lockedGeometry.length < 2 || !(rejoinAlongM > 0)) return 0;
  const sample = measureOffRouteLateral(userLngLat, lockedGeometry, alongHintM);
  return Math.max(0, rejoinAlongM - sample.alongM);
}

export function formatDetourRejoinDistanceM(meters: number): string {
  const mi = meters / MI;
  if (mi < 0.15) return "ahead";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}
