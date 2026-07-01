import { METERS_PER_MILE } from "./constants";
import {
  measureOffRouteLateral,
  OFF_ROUTE_REROUTE_EXIT_M,
} from "./offRouteDetect";
import { haversineMeters, initialBearingDegrees, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, NavRoute } from "./types";

const MI = METERS_PER_MILE;

/** Shuffle targets for local rejoin — miles ahead on the locked leg. */
export const REJOIN_OFFSETS_MI = [1.2, 2.2, 3.2, 4.5, 5.5] as const;
/** Missed-turn / beside-corridor rejoin — aim closer so Mapbox does not U-turn back. */
export const REJOIN_OFFSETS_NEAR_MI = [0.35, 0.55, 0.85, 1.2, 2.0] as const;

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

  const minAhead = Math.min(0.65 * MI, Math.max(350, totalM * 0.02));
  const target = along + Math.max(minAhead, offsetM);
  return Math.min(Math.max(0, totalM - 25), target);
}

function routeStartsWithUturn(r: NavRoute): boolean {
  const step = r.turnSteps?.[0];
  if (!step) return false;
  const mod = (step.maneuverModifier ?? "").toLowerCase();
  const type = (step.maneuverType ?? "").toLowerCase();
  const instr = step.instruction ?? "";
  return mod.includes("uturn") || type.includes("uturn") || /u-?turn/i.test(instr);
}

function headingDeltaDegrees(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Prefer the shortest-time detour that does not wander excessively. */
export function pickBestRejoinRoute(
  routes: NavRoute[],
  userLngLat: LngLat,
  rejoinPt: LngLat,
  headingDeg?: number | null
): NavRoute | null {
  if (!routes.length) return null;
  if (routes.length === 1) return routes[0]!;

  const straightM = Math.max(haversineMeters(userLngLat, rejoinPt), 80);
  const scored = routes.map((r, index) => {
    const lenM = polylineLengthMeters(r.geometry);
    const etaMin = r.baseEtaMinutes ?? 99;
    const detourRatio = lenM / straightM;
    let score = etaMin * 2 + detourRatio * 6 + lenM / 1200 + index * 0.05;
    if (routeStartsWithUturn(r)) score += 12;
    if (
      headingDeg != null &&
      Number.isFinite(headingDeg) &&
      r.geometry.length >= 2
    ) {
      const departBearing = initialBearingDegrees(userLngLat, r.geometry[1]!);
      if (headingDeltaDegrees(headingDeg, departBearing) > 100) {
        score += 8;
      }
    }
    return { r, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0]!.r;
}

/** Order B/C so the best detour is first — locked route id is unchanged. */
export function orderRejoinRoutesBestFirst(
  routes: NavRoute[],
  userLngLat: LngLat,
  rejoinPt: LngLat,
  headingDeg?: number | null
): NavRoute[] {
  if (routes.length <= 1) return routes;
  const best = pickBestRejoinRoute(routes, userLngLat, rejoinPt, headingDeg);
  if (!best) return routes;
  const rest = routes.filter((r) => r.id !== best.id);
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
