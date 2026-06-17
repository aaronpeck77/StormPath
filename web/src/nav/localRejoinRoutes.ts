import { METERS_PER_MILE } from "./constants";
import { pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, NavRoute, TripPlan } from "./types";
import { collectMapboxRouteVariants } from "../services/mapboxDirectionsRouter";
import { fetchMapboxSurgicalBypass } from "../services/mapboxRouteAlternatives";

const MI = METERS_PER_MILE;

/** How far ahead on the locked leg to aim for rejoin (m). */
const REJOIN_OFFSETS_M = [1.2 * MI, 2.2 * MI, 3.2 * MI] as const;

export function pickLocalRejoinAlongM(
  userAlongM: number,
  totalM: number,
  shufflePass = 0
): number {
  if (!Number.isFinite(totalM) || totalM <= 0) return 0;
  const along = Math.max(0, userAlongM);
  const offset = REJOIN_OFFSETS_M[shufflePass % REJOIN_OFFSETS_M.length]!;
  const minAhead = Math.min(0.65 * MI, Math.max(350, totalM * 0.02));
  const target = along + Math.max(minAhead, offset);
  return Math.min(Math.max(0, totalM - 25), target);
}

function altRouteIds(plan: TripPlan, primaryId: string): string[] {
  return plan.routes.filter((r) => r.id !== primaryId).map((r) => r.id);
}

/**
 * Local detour options only — from current GPS to a rejoin point on the locked route ahead.
 * Does not replan the remainder of the trip to the destination.
 */
export async function fetchLocalRejoinRoutes(opts: {
  accessToken: string;
  userLngLat: LngLat;
  lockedGeometry: LngLat[];
  userAlongM: number;
  plan: TripPlan;
  primaryId: string;
  shufflePass?: number;
  signal?: AbortSignal;
  isPlus: boolean;
}): Promise<NavRoute[]> {
  const {
    accessToken,
    userLngLat,
    lockedGeometry,
    userAlongM,
    plan,
    primaryId,
    shufflePass = 0,
    signal,
    isPlus,
  } = opts;

  const altIds = altRouteIds(plan, primaryId);
  if (!altIds.length || lockedGeometry.length < 2) return [];

  const totalM = polylineLengthMeters(lockedGeometry);
  const rejoinM = pickLocalRejoinAlongM(userAlongM, totalM, shufflePass);
  const rejoinPt = pointAtAlongMeters(lockedGeometry, rejoinM);

  const variants = await collectMapboxRouteVariants(accessToken, userLngLat, rejoinPt, {
    signal,
    preferThreeRoutes: isPlus && altIds.length >= 2,
    allowLocalTripThirdRoute: isPlus && altIds.length >= 2,
    skipStormLegRefinement: true,
    rejoinShufflePass: shufflePass,
  });

  const out: NavRoute[] = [];
  const pool = variants.filter((r) => r.geometry.length >= 2);

  if (pool[0]) {
    out.push({ ...pool[0], id: altIds[0]!, label: "Rejoin B" });
  }
  if (altIds.length >= 2) {
    const second =
      pool.find((r) => r.id !== pool[0]?.id && r.geometry.length >= 2) ?? pool[1];
    if (second) {
      out.push({ ...second, id: altIds[1]!, label: "Rejoin C" });
    } else {
      const rejoinM2 = pickLocalRejoinAlongM(userAlongM, totalM, shufflePass + 1);
      const rejoinPt2 = pointAtAlongMeters(lockedGeometry, rejoinM2);
      const surgical = await fetchMapboxSurgicalBypass(accessToken, userLngLat, rejoinPt2);
      if (surgical?.geometry.length) {
        out.push({
          id: altIds[1]!,
          role: "balanced",
          label: "Rejoin C",
          geometry: surgical.geometry,
          baseEtaMinutes: Math.max(1, Math.round(surgical.durationMinutes)),
          turnSteps: surgical.turnSteps,
        });
      }
    }
  }

  return out;
}
