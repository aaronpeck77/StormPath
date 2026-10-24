import { isLongTripRoute, LONG_TRIP_ROUTE_M } from "../utils/dataSaver";
import {
  closestAlongRouteMeters,
  haversineMeters,
  polylineLengthMeters,
  slicePolylineBetweenAlong,
} from "./routeGeometry";
import type { LngLat } from "./types";

/** Core + Drive detail this far ahead on 100+ mi trips. */
export const LIVE_TRIP_WINDOW_AHEAD_M = LONG_TRIP_ROUTE_M;
/** Roll Core forward before it thinks this window’s dest is the trip dest. */
export const LIVE_TRIP_WINDOW_HANDOFF_REMAINING_M = 64_374;
/** If this little is left, take the rest instead of a stub window. */
const LIVE_TRIP_WINDOW_FINAL_SLOP_M = LIVE_TRIP_WINDOW_AHEAD_M + LIVE_TRIP_WINDOW_HANDOFF_REMAINING_M;
const CORRIDOR_ORIGIN_PAD_M = 40;
/** Core “arrived” at a window end is not the pin. */
export const LIVE_TRIP_WINDOW_FAKE_ARRIVE_M = 2_500;

export type LiveTripWindow = {
  startAlongM: number;
  endAlongM: number;
  totalPlanM: number;
  isFinal: boolean;
};

export function computeLiveTripWindow(
  corridor: LngLat[] | null | undefined,
  userLngLat: LngLat | null
): LiveTripWindow | null {
  if (!corridor || corridor.length < 2) return null;
  const totalPlanM = polylineLengthMeters(corridor);
  if (totalPlanM < 80) return null;
  const userAlong = userLngLat
    ? closestAlongRouteMeters(userLngLat, corridor).alongMeters
    : 0;
  const startAlongM = Math.max(0, Math.min(totalPlanM - 50, userAlong - CORRIDOR_ORIGIN_PAD_M));
  const remainingM = totalPlanM - startAlongM;
  if (!isLongTripRoute(totalPlanM) || remainingM <= LIVE_TRIP_WINDOW_FINAL_SLOP_M) {
    return { startAlongM, endAlongM: totalPlanM, totalPlanM, isFinal: true };
  }
  const endAlongM = Math.min(totalPlanM, startAlongM + LIVE_TRIP_WINDOW_AHEAD_M);
  return {
    startAlongM,
    endAlongM,
    totalPlanM,
    isFinal: endAlongM >= totalPlanM - 500,
  };
}

/** Remaining corridor Core should navigate — full remaining on short trips, ~100 mi on long ones. */
export function sliceCorridorToLiveWindow(
  corridor: LngLat[],
  userLngLat: LngLat | null
): LngLat[] {
  const window = computeLiveTripWindow(corridor, userLngLat);
  if (!window) return corridor;
  const slice = slicePolylineBetweenAlong(corridor, window.startAlongM, window.endAlongM);
  return slice.length >= 2 ? slice : corridor;
}

export function shouldHandoffLiveTripWindow(
  window: LiveTripWindow,
  userAlongM: number
): boolean {
  if (window.isFinal) return false;
  const along = Number.isFinite(userAlongM) ? userAlongM : 0;
  const remaining = window.endAlongM - along;
  return remaining <= LIVE_TRIP_WINDOW_HANDOFF_REMAINING_M && remaining >= 0;
}

/** True when Core’s arrived event is the real destination pin, not a rolling window end. */
export function isPlanDestinationArrival(
  destLngLat: LngLat | null | undefined,
  userLngLat: LngLat | null | undefined,
  window: LiveTripWindow | null
): boolean {
  if (!destLngLat || !userLngLat) return false;
  if (window && !window.isFinal) return false;
  return haversineMeters(userLngLat, destLngLat) <= LIVE_TRIP_WINDOW_FAKE_ARRIVE_M;
}
