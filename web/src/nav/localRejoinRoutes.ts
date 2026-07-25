import {
  filterForwardRejoinRoutes,
  isReverseRejoinRoute,
  orderRejoinRoutesBestFirst,
  pickLocalRejoinAlongM,
  type PickRejoinAlongOpts,
} from "./detourRejoin";
import { rejoinOverlaySlotIds } from "./mergePlanRoutes";
import { pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, NavRoute, TripPlan } from "./types";
import { collectMapboxRouteVariants } from "../services/mapboxDirectionsRouter";
import { fetchMapboxSurgicalBypass } from "../services/mapboxRouteAlternatives";

export { pickLocalRejoinAlongM } from "./detourRejoin";

export type LocalRejoinFetchResult = {
  routes: NavRoute[];
  rejoinAlongM: number;
};

const MAX_REJOIN_SHUFFLES = 3;

/**
 * Local detour options only — from current GPS to a rejoin point on the locked route ahead.
 * Never returns reverse / U-turn stubs (empty result instead — caller may escalate).
 */
export async function fetchLocalRejoinRoutes(opts: {
  accessToken: string;
  userLngLat: LngLat;
  lockedGeometry: LngLat[];
  /** Best-known along on the locked corridor (use max of leave-latch and live). */
  userAlongM: number;
  plan: TripPlan;
  primaryId: string;
  shufflePass?: number;
  signal?: AbortSignal;
  isPlus: boolean;
  speedMps?: number;
  lateralM?: number;
  bearingDeg?: number | null;
  /** Keep no-interstate / preferred corridors off motorways on the rejoin stub. */
  preferBackroads?: boolean;
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
    preferBackroads = false,
  } = opts;

  if (lockedGeometry.length < 2) {
    return { routes: [], rejoinAlongM: 0 };
  }
  /* Basic / single-route plans still need one overlay slot for the forward stub. */
  const altIds = rejoinOverlaySlotIds(plan, primaryId);

  const pickOpts: PickRejoinAlongOpts = { speedMps, lateralM };
  const totalM = polylineLengthMeters(lockedGeometry);
  let lastRejoinM = 0;

  for (let pass = 0; pass < MAX_REJOIN_SHUFFLES; pass++) {
    const shuffle = shufflePass + pass;
    const rejoinM = pickLocalRejoinAlongM(userAlongM, totalM, shuffle, pickOpts);
    lastRejoinM = rejoinM;
    const rejoinPt = pointAtAlongMeters(lockedGeometry, rejoinM);

    const variants = await collectMapboxRouteVariants(accessToken, userLngLat, rejoinPt, {
      signal,
      maxRoutes: isPlus ? 2 : 1,
      preferThreeRoutes: false,
      allowLocalTripThirdRoute: false,
      skipStormLegRefinement: true,
      rejoinShufflePass: shuffle,
      singleRouteFromPosition: true,
      forwardFirst: true,
      preferBackroads,
      bearingDeg:
        bearingDeg != null && Number.isFinite(bearingDeg) ? bearingDeg : undefined,
    });

    const pool = variants.filter((r) => r.geometry.length >= 2);
    const out: NavRoute[] = [];

    if (pool[0]) {
      out.push({ ...pool[0], id: altIds[0]!, label: "Rejoin B" });
    }
    if (altIds.length >= 2) {
      const second =
        pool.find((r) => r.id !== pool[0]?.id && r.geometry.length >= 2) ?? pool[1];
      if (second) {
        out.push({ ...second, id: altIds[1]!, label: "Rejoin C" });
      } else {
        const rejoinM2 = pickLocalRejoinAlongM(userAlongM, totalM, shuffle + 1, pickOpts);
        const rejoinPt2 = pointAtAlongMeters(lockedGeometry, rejoinM2);
        const surgical = await fetchMapboxSurgicalBypass(accessToken, userLngLat, rejoinPt2, {
          bearingDeg:
            bearingDeg != null && Number.isFinite(bearingDeg) ? bearingDeg : undefined,
        });
        if (surgical?.geometry.length) {
          const surgicalRoute: NavRoute = {
            id: altIds[1]!,
            role: "balanced",
            label: "Rejoin C",
            geometry: surgical.geometry,
            baseEtaMinutes: Math.max(1, Math.round(surgical.durationMinutes)),
            turnSteps: surgical.turnSteps,
          };
          if (!isReverseRejoinRoute(surgicalRoute, userLngLat, bearingDeg)) {
            out.push(surgicalRoute);
          }
        }
      }
    }

    const ordered = orderRejoinRoutesBestFirst(out, userLngLat, rejoinPt, bearingDeg);
    if (ordered.length > 0) {
      return { routes: ordered, rejoinAlongM: rejoinM };
    }

    /* All reverse — try a farther rejoin target before giving up. */
    if (signal?.aborted) break;
  }

  return { routes: [], rejoinAlongM: lastRejoinM };
}

/** Test helper: expose forward filter without a network fetch. */
export function forwardOnlyRejoinPool(
  routes: NavRoute[],
  userLngLat: LngLat,
  headingDeg?: number | null
): NavRoute[] {
  return filterForwardRejoinRoutes(routes, userLngLat, headingDeg);
}
