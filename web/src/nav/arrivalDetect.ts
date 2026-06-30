import {
  ARRIVAL_DEST_RADIUS_M,
  ARRIVAL_IDLE_CLEAR_MS,
  ARRIVAL_IDLE_CLEAR_NEAR_MS,
  ARRIVAL_IDLE_CLEAR_VERY_NEAR_MS,
  ARRIVAL_ROUTE_END_RADIUS_M,
  ARRIVAL_ROUTE_REMAINING_M,
  ARRIVAL_STATIONARY_MAX_SPEED_MPS,
  ARRIVAL_STATIONARY_UNKNOWN_SPEED_MAX_REMAINING_M,
} from "./constants";
import { haversineMeters } from "./routeGeometry";
import type { LngLat } from "./types";

export type ArrivalProximity = {
  near: boolean;
  /** Meters left along the active route polyline, when known. */
  remainingAlongM: number | null;
};

/** True when the driver is close enough to treat the trip as arrived (multi-signal). */
export function arrivalProximity(args: {
  pos: LngLat;
  dest: LngLat;
  routeGeometry?: LngLat[] | null;
  alongRouteM?: number | null;
  routeLengthM?: number;
}): ArrivalProximity {
  const { pos, dest, routeGeometry, alongRouteM, routeLengthM = 0 } = args;

  let remainingAlongM: number | null = null;
  if (
    routeGeometry &&
    routeGeometry.length >= 2 &&
    routeLengthM > 1 &&
    alongRouteM != null &&
    Number.isFinite(alongRouteM)
  ) {
    remainingAlongM = Math.max(0, routeLengthM - alongRouteM);
    if (remainingAlongM <= ARRIVAL_ROUTE_REMAINING_M) {
      return { near: true, remainingAlongM };
    }
    const end = routeGeometry[routeGeometry.length - 1]!;
    if (haversineMeters(pos, end) <= ARRIVAL_ROUTE_END_RADIUS_M) {
      return { near: true, remainingAlongM };
    }
  }

  if (haversineMeters(pos, dest) <= ARRIVAL_DEST_RADIUS_M) {
    return { near: true, remainingAlongM };
  }

  return { near: false, remainingAlongM };
}

/** Idle time before auto-clear — shorter when already at the end of the line. */
export function arrivalIdleClearMs(remainingAlongM: number | null): number {
  if (remainingAlongM != null && remainingAlongM <= 35) return ARRIVAL_IDLE_CLEAR_VERY_NEAR_MS;
  if (remainingAlongM != null && remainingAlongM <= 90) return ARRIVAL_IDLE_CLEAR_NEAR_MS;
  return ARRIVAL_IDLE_CLEAR_MS;
}

/**
 * GPS speed is often missing right after resume from background — only treat that as stopped
 * when essentially no distance remains; otherwise require an explicit low speed reading.
 */
export function isStationaryForArrival(
  speedMps: number | null | undefined,
  remainingAlongM?: number | null,
): boolean {
  if (speedMps != null && Number.isFinite(speedMps)) {
    return speedMps <= ARRIVAL_STATIONARY_MAX_SPEED_MPS;
  }
  return (
    remainingAlongM != null &&
    remainingAlongM <= ARRIVAL_STATIONARY_UNKNOWN_SPEED_MAX_REMAINING_M
  );
}

/** Map panning shouldn't block auto end-trip; chrome interactions still reset the timer. */
export function shouldResetArrivalIdleOnPointer(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(".mapboxgl-canvas, .map-canvas, .drive-map")) return false;
  return true;
}
