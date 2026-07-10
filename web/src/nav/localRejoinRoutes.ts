import {
  orderRejoinRoutesBestFirst,
  pickLocalRejoinAlongM,
  type PickRejoinAlongOpts,
} from "./detourRejoin";
import { pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, NavRoute, TripPlan } from "./types";
import { collectMapboxRouteVariants } from "../services/mapboxDirectionsRouter";
import { fetchMapboxSurgicalBypass } from "../services/mapboxRouteAlternatives";

export { pickLocalRejoinAlongM } from "./detourRejoin";

function altRouteIds(plan: TripPlan, primaryId: string): string[] {
  return plan.routes.filter((r) => r.id !== primaryId).map((r) => r.id);
}

export type LocalRejoinFetchResult = {
  routes: NavRoute[];
  rejoinAlongM: number;
};

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
  speedMps?: number;
  lateralM?: number;
  bearingDeg?: number | null;
}): Promise<LocalRejoinFetchResult> {
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
    speedMps,
    lateralM,
    bearingDeg,
  } = opts;

  const altIds = altRouteIds(plan, primaryId);
  if (!altIds.length || lockedGeometry.length < 2) {
    return { routes: [], rejoinAlongM: 0 };
  }

  const pickOpts: PickRejoinAlongOpts = { speedMps, lateralM };
  const totalM = polylineLengthMeters(lockedGeometry);
  const rejoinM = pickLocalRejoinAlongM(userAlongM, totalM, shufflePass, pickOpts);
  const rejoinPt = pointAtAlongMeters(lockedGeometry, rejoinM);

  const variants = await collectMapboxRouteVariants(accessToken, userLngLat, rejoinPt, {
    signal,
    maxRoutes: isPlus ? 2 : 1,
    preferThreeRoutes: false,
    allowLocalTripThirdRoute: false,
    skipStormLegRefinement: true,
    rejoinShufflePass: shufflePass,
    bearingDeg:
      bearingDeg != null && Number.isFinite(bearingDeg) ? bearingDeg : undefined,
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
      const rejoinM2 = pickLocalRejoinAlongM(userAlongM, totalM, shufflePass + 1, pickOpts);
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

  const ordered = orderRejoinRoutesBestFirst(out, userLngLat, rejoinPt, bearingDeg);
  return { routes: ordered, rejoinAlongM: rejoinM };
}
